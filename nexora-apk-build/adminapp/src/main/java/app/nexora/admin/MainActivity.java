package app.nexora.admin;
import android.net.Uri;
import app.nexora.webcore.NexoraWebActivity;
public class MainActivity extends NexoraWebActivity {
 private static final String HOST="all-tools-nexora-teal.vercel.app"; private static final String ADMIN="https://"+HOST+"/admin";
 @Override protected String startUrl(){return ADMIN;}
 @Override protected boolean isNavigationAllowed(Uri uri){String host=uri.getHost();return "https".equalsIgnoreCase(uri.getScheme())&&host!=null&&HOST.equalsIgnoreCase(host);}
 @Override protected String blockedNavigationFallback(){return ADMIN;}
}
