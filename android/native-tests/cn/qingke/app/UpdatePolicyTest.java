package cn.qingke.app;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;

public final class UpdatePolicyTest {
    private static int checks;
    private static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    private interface Check {void run()throws Exception;}
    private static void reject(Check fn,String message){checks++;try{fn.run();throw new AssertionError(message);}catch(IllegalArgumentException|IOException expected){}catch(Exception error){throw new AssertionError(error);}}
    public static void main(String[]args)throws Exception{
        String digest="a".repeat(64),source=UpdatePolicy.asset("cn.qingke.app",4,"3.1.0","v3.1.0","qingke-3.1.0-release.apk",5000000,digest);
        check(source.equals("https://github.com/SAGIRIxr/qingke/releases/download/v3.1.0/qingke-3.1.0-release.apk"),"Official repository and asset are reconstructed");
        check(UpdatePolicy.proxy("").isEmpty(),"Direct mode");check(UpdatePolicy.proxy("https://proxy.example").equals("https://proxy.example/"),"Proxy root normalization");
        for(String invalid:new String[]{"http://proxy.example/","https://user:pw@proxy.example/","https://proxy.example/api/","https://proxy.example/?target=x","https://proxy.example/#secret","https://proxy.example\\@evil.example/","https://proxy.example:0/"})reject(()->UpdatePolicy.proxy(invalid),"Reject malformed proxy "+invalid);
        reject(()->UpdatePolicy.asset("other.app",4,"3.1.0","v3.1.0","qingke-3.1.0-release.apk",5000000,digest),"Reject other package");
        reject(()->UpdatePolicy.asset("cn.qingke.app",4,"3.1.0","v3.1.1","qingke-3.1.0-release.apk",5000000,digest),"Version and tag must match");
        reject(()->UpdatePolicy.asset("cn.qingke.app",4,"3.1.0","v3.1.0","../../evil.apk",5000000,digest),"Reject arbitrary asset paths");
        reject(()->UpdatePolicy.asset("cn.qingke.app",4,"3.1.0","v3.1.0","qingke-3.1.0-release.apk",UpdatePolicy.MAX_APK+1,digest),"Bound APK size");
        reject(()->UpdatePolicy.asset("cn.qingke.app",4,"3.1.0","v3.1.0","qingke-3.1.0-release.apk",5000000,"zz".repeat(32)),"Reject nonhash digest");
        String releaseManifest=UpdatePolicy.REPOSITORY+"/releases/download/v3.1.0/update.json";
        check(UpdatePolicy.redirect(releaseManifest,UpdatePolicy.MANIFEST,"",UpdatePolicy.MANIFEST).equals(releaseManifest),"Allow latest resolution within same repository");
        String cdn="https://release-assets.githubusercontent.com/github-production-release-asset/123/file?sig=test";
        check(UpdatePolicy.redirect(cdn,source,"",source).equals(cdn),"Allow GitHub signed release CDN");
        check(UpdatePolicy.redirect("https://proxy.example/"+releaseManifest,UpdatePolicy.transport(UpdatePolicy.MANIFEST,"https://proxy.example/"),"https://proxy.example/",UpdatePolicy.MANIFEST).contains(releaseManifest),"Allow same proxy resolving a fixed GitHub source");
        for(String bad:new String[]{"http://github.com/SAGIRIxr/qingke/releases/download/v3.1.0/update.json","https://github.com/other/project/releases/download/v3.1.0/update.json","https://evil.example/file.apk","https://release-assets.githubusercontent.com.evil.example/github-production-release-asset/x","https://objects.githubusercontent.com/not-a-release","https://user@release-assets.githubusercontent.com/github-production-release-asset/x","https://proxy.example/https://github.com/other/repo/releases/download/v3.1.0/update.json"})reject(()->UpdatePolicy.redirect(bad,UpdatePolicy.MANIFEST,"https://proxy.example/",UpdatePolicy.MANIFEST),"Reject redirect escape "+bad);
        reject(()->UpdatePolicy.redirect(UpdatePolicy.REPOSITORY+"/releases/download/v9.0.0/qingke-9.0.0-release.apk",source,"",source),"APK redirect may not change declared version");
        byte[][] original={new byte[]{1,2,3}},same={new byte[]{1,2,3}},other={new byte[]{9,8,7}};
        UpdatePolicy.validateArchive("cn.qingke.app",3,4,4,false,original,same);check(true,"Upgrade with exact signer accepted");
        reject(()->UpdatePolicy.validateArchive("cn.qingke.app",3,3,3,false,original,same),"Reject replay");
        reject(()->UpdatePolicy.validateArchive("cn.qingke.app",4,3,3,false,original,same),"Reject downgrade");
        reject(()->UpdatePolicy.validateArchive("cn.qingke.app",3,5,4,false,original,same),"Manifest version must match archive");
        reject(()->UpdatePolicy.validateArchive("cn.qingke.app",3,4,4,true,original,same),"Reject debuggable update");
        reject(()->UpdatePolicy.validateArchive("cn.qingke.app",3,4,4,false,original,other),"Reject foreign signature");
        reject(()->UpdatePolicy.validateArchive("cn.qingke.app",3,4,4,false,null,same),"Reject missing signature");
        reject(()->UpdatePolicy.validateArchive("cn.qingke.app",3,4,4,false,new byte[][]{null},new byte[][]{null}),"Reject null signers");
        UpdatePolicy.validateArchive("cn.qingke.app",3,4,4,false,new byte[][]{original[0],other[0]},new byte[][]{other[0],same[0]});check(true,"Signer set comparison permits order changes");
        reject(()->UpdatePolicy.validateArchive("cn.qingke.app",3,4,4,false,new byte[][]{original[0],original[0]},new byte[][]{other[0],same[0]}),"Duplicate signers cannot mask mismatch");
        byte[] content=new byte[4096];for(int i=0;i<content.length;i++)content[i]=(byte)(i%251);String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        ByteArrayOutputStream copied=new ByteArrayOutputStream();long total=UpdateDownload.copy(new ByteArrayInputStream(content),copied,content.length,hash,()->{},n->{});
        check(total==content.length&&Arrays.equals(content,copied.toByteArray()),"Bounded download preserves exact verified bytes");
        reject(()->UpdateDownload.copy(new ByteArrayInputStream(content),new ByteArrayOutputStream(),content.length-1,hash,()->{},n->{}),"Reject overlong stream even without Content-Length");
        reject(()->UpdateDownload.copy(new ByteArrayInputStream(content),new ByteArrayOutputStream(),content.length+1,hash,()->{},n->{}),"Reject truncated stream");
        byte[] modified=content.clone();modified[31]^=1;
        reject(()->UpdateDownload.copy(new ByteArrayInputStream(modified),new ByteArrayOutputStream(),modified.length,hash,()->{},n->{}),"Reject bit-tampered APK even at correct size");
        ByteArrayOutputStream cancelled=new ByteArrayOutputStream();reject(()->UpdateDownload.copy(new ByteArrayInputStream(content),cancelled,content.length,hash,()->{throw new IOException("cancelled");},n->{}),"Cancellation before read");
        check(cancelled.size()==0,"Cancelled download emits no bytes");
        System.out.println("PASS: "+checks+" update security checks");
    }
}
