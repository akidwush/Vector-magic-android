package app.nexora.tools;
import android.net.Uri;
import app.nexora.webcore.NexoraWebActivity;
public class MainActivity extends NexoraWebActivity {
 private static final String HOST="all-tools-nexora-teal.vercel.app"; private static final String HOME="https://"+HOST+"/";
 @Override protected String startUrl(){return HOME;}
 @Override protected boolean isNavigationAllowed(Uri uri){return isHttpsNexora(uri)&&!isAdminPath(uri);}
 @Override protected boolean shouldUseBlockedFallback(Uri uri){return isHttpsNexora(uri)&&isAdminPath(uri);}
 @Override protected String blockedNavigationFallback(){return HOME;}
 private boolean isHttpsNexora(Uri uri){String host=uri.getHost();return "https".equalsIgnoreCase(uri.getScheme())&&host!=null&&HOST.equalsIgnoreCase(host);}
 private boolean isAdminPath(Uri uri){String path=uri.getPath()==null?"/":uri.getPath().toLowerCase();return path.equals("/admin")||path.startsWith("/admin/")||path.startsWith("/api/admin");}
}
