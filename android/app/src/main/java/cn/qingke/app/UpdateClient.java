package cn.qingke.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledExecutorService;
import javax.net.ssl.HttpsURLConnection;

/** User-triggered official-release updater. No WebView cookies, arbitrary paths, or silent installs. */
final class UpdateClient {
    interface Listener {
        void onEvent(JSONObject event);
        void onInstallPermissionNeeded();
        void onInstallReady(Uri uri);
    }
    private final Context context;
    private final SharedPreferences prefs;
    private final File directory;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> new Thread(r, "qingke-update"));
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor(r -> new Thread(r, "qingke-update-deadline"));
    private volatile Listener listener;
    private volatile boolean closed;
    private Task active;
    private Manifest latest, verified;
    private String proxy = "", phase = "idle", message = "";
    private long downloadedBytes;
    private static final class Task {
        final String id;
        volatile boolean cancelled, timedOut;
        volatile HttpsURLConnection connection;
        Task(String id) { this.id = id; }
    }
    private static final class Manifest {
        final long code, size;
        final String name, tag, asset, sha256, notes, source;
        Manifest(JSONObject json) throws JSONException {
            if (!"qingke-update".equals(json.optString("format")) || integer(json, "version") != 1) throw new JSONException("不支持的更新清单");
            code = integer(json, "versionCode"); size = integer(json, "size");
            name = text(json,"versionName"); tag = text(json,"tag"); asset = text(json,"asset"); sha256 = text(json,"sha256").toLowerCase(Locale.ROOT);
            notes = json.has("notes") ? text(json,"notes") : "";
            if (notes.length() > 4000) throw new JSONException("更新说明过长");
            source = UpdatePolicy.asset(text(json,"packageName"), code, name, tag, asset, size, sha256);
        }
        JSONObject json() throws JSONException {
            return new JSONObject().put("format","qingke-update").put("version",1).put("packageName",UpdatePolicy.PACKAGE)
                    .put("versionCode",code).put("versionName",name).put("tag",tag).put("asset",asset).put("size",size).put("sha256",sha256).put("notes",notes);
        }
        private static String text(JSONObject json,String key) throws JSONException { Object v=json.get(key); if(!(v instanceof String))throw new JSONException("更新字段格式无效："+key);return (String)v; }
        private static long integer(JSONObject json,String key) throws JSONException {
            Object v=json.get(key); if(!(v instanceof Integer)&&!(v instanceof Long))throw new JSONException("更新字段应为整数："+key);return ((Number)v).longValue();
        }
    }
    UpdateClient(Context context, Listener listener) {
        this.context = context.getApplicationContext(); this.listener = listener;
        prefs = this.context.getSharedPreferences("qingke_updates", Context.MODE_PRIVATE);
        directory = new File(this.context.getFilesDir(),"updates");
        try {
            String raw = prefs.getString("verified", "");
            if (!raw.isEmpty()) {
                Manifest saved = new Manifest(new JSONObject(raw));
                if (saved.code > BuildConfig.VERSION_CODE && apk(saved).isFile() && apk(saved).length() == saved.size) { verified = latest = saved; phase = "downloaded"; }
                else { prefs.edit().remove("verified").remove("resumeInstall").apply(); if (apk(saved).isFile()) apk(saved).delete(); }
            }
        } catch (Exception error) { prefs.edit().remove("verified").remove("resumeInstall").apply(); }
    }
    private File apk(Manifest manifest) { return new File(directory,manifest.sha256+".apk"); }
    synchronized JSONObject status() {
        JSONObject result = new JSONObject();
        try {
            result.put("phase",phase).put("busy",active!=null).put("currentVersion",BuildConfig.VERSION_NAME).put("currentVersionCode",BuildConfig.VERSION_CODE)
                    .put("packageName",UpdatePolicy.PACKAGE).put("canInstallUnknown",context.getPackageManager().canRequestPackageInstalls())
                    .put("ready",verified!=null&&apk(verified).isFile()&&(latest==null||verified.sha256.equals(latest.sha256))).put("downloadedBytes",downloadedBytes).put("message",message)
                    .put("defaultProxy",UpdatePolicy.DEFAULT_PROXY).put("source",UpdatePolicy.REPOSITORY);
            if (latest!=null) result.put("manifest",latest.json()).put("totalBytes",latest.size);
        } catch (JSONException ignored) { }
        return result;
    }
    private synchronized Task begin(String id, String phase) {
        if (closed) return null;
        if (id==null||!id.matches("[A-Za-z0-9_.:-]{1,100}")) { emit("error", "", "更新请求标识无效"); return null; }
        if (active!=null) { emit("error",id,"另一个更新操作正在进行");return null; }
        Task task=new Task(id);active=task;this.phase=phase;message="";emit(phase,id,"");return task;
    }
    void check(String id,String proxyBase) {
        final String chosen;
        try { chosen=UpdatePolicy.proxy(proxyBase); } catch (IllegalArgumentException error) { emit("error",id,error.getMessage());return; }
        Task task=begin(id,"checking");if(task==null)return;
        run(task,60_000,()->{
            byte[] bytes=readManifest(task,UpdatePolicy.transport(UpdatePolicy.MANIFEST,chosen),chosen);
            JSONTokener tokener=new JSONTokener(new String(bytes,StandardCharsets.UTF_8));
            Object raw=tokener.nextValue();if(!(raw instanceof JSONObject)||tokener.nextClean()!=0)throw new JSONException("更新清单不是 JSON 对象");
            Manifest manifest=new Manifest((JSONObject)raw);check(task);
            synchronized(this){latest=manifest;proxy=chosen;downloadedBytes=0;phase=manifest.code>BuildConfig.VERSION_CODE?"available":"latest";}
            finish(task,phase,manifest.code>BuildConfig.VERSION_CODE?"发现新版本":"当前已是最新版本");
        });
    }
    void download(String id) {
        final Manifest manifest;final String chosen;
        synchronized(this){manifest=latest;chosen=proxy;}
        if(manifest==null||manifest.code<=BuildConfig.VERSION_CODE){emit("error",id,"请先检查可用的新版本");return;}
        Task task=begin(id,"downloading");if(task==null)return;
        run(task,15*60_000,()->{
            if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法建立更新缓存目录");
            if(directory.getUsableSpace()<manifest.size+8*1024*1024L)throw new IOException("存储空间不足，无法下载更新");
            // An Activity replacement may start another worker before the old socket exits.
            // Separate temporary names prevent the old finally block deleting the new download.
            File part=new File(directory,"download-"+java.util.UUID.randomUUID()+".part");
            try {
                HttpsURLConnection connection=open(task,UpdatePolicy.transport(manifest.source,chosen),chosen,manifest.source);
                long length=connection.getContentLengthLong();if(length>=0&&length!=manifest.size)throw new IOException("下载大小与更新清单不一致");
                long count;final long[] lastProgress={0};
                try(InputStream input=connection.getInputStream();FileOutputStream output=new FileOutputStream(part)){
                    count=UpdateDownload.copy(input,output,manifest.size,manifest.sha256,()->check(task),received->{
                        long now=SystemClock.elapsedRealtime();if(now-lastProgress[0]>=400){synchronized(this){downloadedBytes=received;}emit("progress",task.id,"");lastProgress[0]=now;}});
                    output.getFD().sync();
                }
                check(task);validateArchive(part,manifest);check(task);
                synchronized(this){
                    check(task);File finalFile=apk(manifest);
                    if(finalFile.exists()&&!finalFile.delete())throw new IOException("无法替换旧更新文件");
                    if(!part.renameTo(finalFile))throw new IOException("无法保存已校验的安装包");
                    if(!prefs.edit().putString("verified",manifest.json().toString()).commit()){finalFile.delete();throw new IOException("无法保存安装校验信息");}
                    verified=manifest;downloadedBytes=count;
                }
                finish(task,"downloaded","包名、版本、SHA-256 和签名已验证，可以安装");
            } finally { if(part.exists())part.delete(); }
        });
    }
    void install() {
        final Manifest manifest;synchronized(this){manifest=verified;}
        if(manifest==null||latest!=null&&!manifest.sha256.equals(latest.sha256)){emit("error","","请先下载并校验当前更新版本");return;}
        if(!context.getPackageManager().canRequestPackageInstalls()){
            if(!prefs.edit().putBoolean("resumeInstall",true).commit()){emit("error","","无法保存待安装状态");return;}
            emit("permission","","请在系统中允许清课安装应用，返回后继续");
            main.post(()->{Listener l=listener;if(!closed&&l!=null)l.onInstallPermissionNeeded();});return;
        }
        Task task=begin("install-"+SystemClock.elapsedRealtime(),"verifying");if(task==null)return;
        run(task,60_000,()->{
            File file=apk(manifest);check(task);
            if(file.length()!=manifest.size||!digest(file,task).equals(manifest.sha256))throw new IOException("缓存安装包已变化，请重新下载");
            validateArchive(file,manifest);check(task);prefs.edit().remove("resumeInstall").apply();
            finish(task,"installing","请在系统安装界面确认更新");
            Uri uri=Uri.parse("content://"+UpdateFileProvider.AUTHORITY+"/"+file.getName());
            main.post(()->{Listener l=listener;if(!closed&&!task.cancelled&&l!=null)l.onInstallReady(uri);});
        });
    }
    void resume() {
        if(prefs.getBoolean("resumeInstall",false)&&context.getPackageManager().canRequestPackageInstalls()){prefs.edit().remove("resumeInstall").apply();install();}
        else emit("status","","");
    }
    synchronized void cancel() {
        Task task=active;if(task!=null){task.cancelled=true;if(task.connection!=null)task.connection.disconnect();}
        prefs.edit().remove("resumeInstall").apply();
    }
    synchronized void close() {
        closed=true;
        if(active!=null){active.cancelled=true;if(active.connection!=null)active.connection.disconnect();}
        // Keep a user-requested permission continuation across Activity/process recreation.
        listener=null;worker.shutdownNow();watchdog.shutdownNow();main.removeCallbacksAndMessages(null);
    }
    private interface Work { void run() throws Exception; }
    private void run(Task task,long timeout,Work operation) {
        UpdateJobs.submit(worker,watchdog,timeout,
            ()->{task.timedOut=true;task.cancelled=true;HttpsURLConnection connection=task.connection;if(connection!=null)connection.disconnect();},()->{
            try { check(task);operation.run(); }
            catch(Exception error){finish(task,task.cancelled&&!task.timedOut?"cancelled":"error",task.timedOut?"更新操作超时，请检查网络或更换代理":task.cancelled?"更新已取消":safeMessage(error));}
            finally { if(task.connection!=null)task.connection.disconnect();synchronized(this){if(active==task)active=null;} }
        },()->finish(task,"cancelled","更新已取消"));
    }
    private static String safeMessage(Exception error) {
        if(error instanceof JSONException)return "更新清单格式无效";
        if(error instanceof java.net.SocketTimeoutException)return "下载连接超时，请检查网络或更换代理";
        String message=error.getMessage();
        return message!=null&&message.matches("[\\p{IsHan}A-Za-z0-9 ，。、：-]{1,160}")?message:"更新失败，请检查网络或更换代理后重试";
    }
    private void check(Task task) throws IOException {if(closed||task.cancelled||Thread.currentThread().isInterrupted())throw new IOException("更新已取消");}
    private synchronized void finish(Task task,String phase,String message) {if(active!=task)return;active=null;this.phase=phase;this.message=message;emit(phase,task.id,message);}
    private void emit(String type,String id,String message) {
        JSONObject event=status();try{event.put("type",type).put("requestId",id==null?"":id);if(!message.isEmpty())event.put("message",message);}catch(JSONException ignored){}
        main.post(()->{Listener l=listener;if(!closed&&l!=null)l.onEvent(event);});
    }
    private HttpsURLConnection open(Task task,String url,String chosen,String source) throws Exception {
        for(int redirects=0;redirects<=5;redirects++){
            check(task);HttpsURLConnection connection=(HttpsURLConnection)new URL(url).openConnection();task.connection=connection;
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15_000);connection.setReadTimeout(25_000);
            connection.setRequestProperty("User-Agent","Qingke/"+BuildConfig.VERSION_NAME);connection.setRequestProperty("Accept-Encoding","identity");
            connection.setRequestProperty("Accept",source.equals(UpdatePolicy.MANIFEST)?"application/json":"application/octet-stream");
            int code=connection.getResponseCode();check(task);
            if(code==200)return connection;
            if(code==301||code==302||code==303||code==307||code==308){String location=connection.getHeaderField("Location");connection.disconnect();if(location==null)throw new IOException("更新重定向缺少目标");url=UpdatePolicy.redirect(location,url,chosen,source);continue;}
            connection.disconnect();if(code==404)throw new IOException("尚未发布可用的更新文件");throw new IOException("更新服务暂不可用 "+code);
        }
        throw new IOException("更新服务重定向次数过多");
    }
    private byte[] readManifest(Task task,String url,String chosen) throws Exception {
        HttpsURLConnection connection=open(task,url,chosen,UpdatePolicy.MANIFEST);
        if(connection.getContentLengthLong()>UpdatePolicy.MAX_MANIFEST)throw new IOException("更新清单过大");
        try(InputStream input=connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1){check(task);if(bytes.size()+n>UpdatePolicy.MAX_MANIFEST)throw new IOException("更新清单过大");bytes.write(buffer,0,n);}return bytes.toByteArray();
        }
    }
    private String digest(File file,Task task) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");long size=0;
        try(InputStream input=new FileInputStream(file)){byte[] buffer=new byte[64*1024];int n;while((n=input.read(buffer))!=-1){check(task);size+=n;if(size>UpdatePolicy.MAX_APK)throw new IOException("安装包超过允许大小");digest.update(buffer,0,n);}}
        return hex(digest.digest());
    }
    private static String hex(byte[] bytes){StringBuilder text=new StringBuilder();for(byte value:bytes)text.append(String.format(Locale.ROOT,"%02x",value&255));return text.toString();}
    @SuppressWarnings("deprecation") private void validateArchive(File file,Manifest manifest) throws Exception {
        PackageManager manager=context.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo archive=manager.getPackageArchiveInfo(file.getAbsolutePath(),flags),installed=manager.getPackageInfo(context.getPackageName(),flags);
        if(archive==null||archive.applicationInfo==null)throw new IOException("无法读取安装包或验证签名");
        long current=Build.VERSION.SDK_INT>=28?installed.getLongVersionCode():installed.versionCode;
        long candidate=Build.VERSION.SDK_INT>=28?archive.getLongVersionCode():archive.versionCode;
        UpdatePolicy.validateArchive(archive.packageName,current,candidate,manifest.code,(archive.applicationInfo.flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0,signers(installed),signers(archive));
        if(!manifest.name.equals(archive.versionName))throw new IOException("安装包版本名称与清单不一致");
    }
    @SuppressWarnings("deprecation") private static byte[][] signers(PackageInfo info) {
        Signature[] signatures=Build.VERSION.SDK_INT>=28?(info.signingInfo==null?null:info.signingInfo.getApkContentsSigners()):info.signatures;
        if(signatures==null)return null;byte[][] bytes=new byte[signatures.length][];for(int i=0;i<signatures.length;i++)bytes[i]=signatures[i].toByteArray();return bytes;
    }
}
