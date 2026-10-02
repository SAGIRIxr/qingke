package cn.qingke.app;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/** Streaming bound and hash verification shared by HTTP downloads and adversarial JVM tests. */
final class UpdateDownload {
    interface Guard { void check() throws IOException; }
    interface Progress { void received(long bytes); }
    static long copy(InputStream input, OutputStream output, long expectedSize, String expectedHash, Guard guard, Progress progress) throws IOException {
        if(expectedSize<1024||expectedSize>UpdatePolicy.MAX_APK||expectedHash==null||!expectedHash.matches("[a-fA-F0-9]{64}"))throw new IOException("下载校验条件无效");
        MessageDigest digest;
        try{digest=MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException impossible){throw new IOException("系统缺少 SHA-256",impossible);}
        long count=0;byte[] buffer=new byte[64*1024];
        while(true){
            guard.check();int n=input.read(buffer);guard.check();if(n<0)break;
            count+=n;if(count>expectedSize||count>UpdatePolicy.MAX_APK)throw new IOException("安装包超过允许大小");
            output.write(buffer,0,n);digest.update(buffer,0,n);progress.received(count);
        }
        StringBuilder hex=new StringBuilder();for(byte value:digest.digest())hex.append(String.format(Locale.ROOT,"%02x",value&255));
        if(count!=expectedSize||!hex.toString().equalsIgnoreCase(expectedHash))throw new IOException("安装包 SHA-256 或大小校验失败，已删除下载文件");
        return count;
    }
}
