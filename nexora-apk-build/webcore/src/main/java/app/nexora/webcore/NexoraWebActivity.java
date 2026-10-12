package app.nexora.webcore;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public abstract class NexoraWebActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 7101;
    private static final int STORAGE_PERMISSION_REQUEST = 7102;
    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    protected abstract String startUrl();
    protected abstract boolean isNavigationAllowed(Uri uri);
    protected boolean shouldUseBlockedFallback(Uri uri) { return false; }
    protected String blockedNavigationFallback() { return startUrl(); }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); configureWindow(); configureWebView();
        if (state == null) webView.loadUrl(startUrl()); else webView.restoreState(state);
    }
    private void configureWindow() {
        Window w=getWindow(); w.setStatusBarColor(Color.rgb(9,3,18)); w.setNavigationBarColor(Color.rgb(9,3,18));
    }
    private void configureWebView() {
        webView=new WebView(this); webView.setBackgroundColor(Color.rgb(9,3,18)); setContentView(webView);
        boolean debug=(getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE)!=0; WebView.setWebContentsDebuggingEnabled(debug);
        WebSettings s=webView.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(true); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT); s.setMediaPlaybackRequiresUserGesture(false); s.setSupportMultipleWindows(false);
        s.setTextZoom(90); s.setUseWideViewPort(true); s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false); s.setBuiltInZoomControls(false); s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString()+" NEXORA-Android/1.1");
        if (Build.VERSION.SDK_INT>=Build.VERSION_CODES.O) s.setSafeBrowsingEnabled(true);
        CookieManager cm=CookieManager.getInstance(); cm.setAcceptCookie(true); cm.setAcceptThirdPartyCookies(webView,true);
        webView.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams p){if(fileChooserCallback!=null)fileChooserCallback.onReceiveValue(null);fileChooserCallback=cb;try{Intent i=p.createIntent();startActivityForResult(i,FILE_CHOOSER_REQUEST);return true;}catch(Exception e){fileChooserCallback=null;Toast.makeText(NexoraWebActivity.this,"Pemilih file tidak tersedia.",Toast.LENGTH_SHORT).show();return false;}}});
        webView.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return handleNavigation(r.getUrl());}
            @Override public boolean shouldOverrideUrlLoading(WebView v,String u){return handleNavigation(Uri.parse(u));}
            @Override public void onPageFinished(WebView v,String url){super.onPageFinished(v,url);v.evaluateJavascript("(function(){var id='nexora-android-text-fix';if(document.getElementById(id))return;var s=document.createElement('style');s.id=id;s.textContent='html{-webkit-text-size-adjust:100%!important;text-size-adjust:100%!important;}';(document.head||document.documentElement).appendChild(s);})();",null);}
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame())loadOfflineFallback();}
        });
        webView.setDownloadListener((url,ua,cd,mime,len)->{if(url==null||!(url.startsWith("https://")||url.startsWith("http://"))){Toast.makeText(this,"Download blob/lokal belum didukung.",Toast.LENGTH_LONG).show();return;}if(Build.VERSION.SDK_INT<=Build.VERSION_CODES.P&&checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},STORAGE_PERMISSION_REQUEST);Toast.makeText(this,"Izinkan penyimpanan lalu ulangi download.",Toast.LENGTH_SHORT).show();return;}enqueueDownload(url,ua,cd,mime);});
    }
    private boolean handleNavigation(Uri uri){if(uri==null)return true;String scheme=uri.getScheme()==null?"":uri.getScheme().toLowerCase();if("https".equals(scheme)||"http".equals(scheme)){if(isNavigationAllowed(uri))return false;if(shouldUseBlockedFallback(uri)){webView.loadUrl(blockedNavigationFallback());Toast.makeText(this,"Dashboard admin dipisahkan dari aplikasi publik.",Toast.LENGTH_SHORT).show();return true;}openExternal(uri);return true;}if("mailto".equals(scheme)||"tel".equals(scheme)||"sms".equals(scheme)||"whatsapp".equals(scheme)){openExternal(uri);return true;}webView.loadUrl(blockedNavigationFallback());return true;}
    private void openExternal(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException e){Toast.makeText(this,"Tidak ada aplikasi untuk membuka tautan ini.",Toast.LENGTH_SHORT).show();}}
    private void enqueueDownload(String url,String ua,String cd,String mime){try{DownloadManager.Request r=new DownloadManager.Request(Uri.parse(url));String fn=URLUtil.guessFileName(url,cd,mime);r.setTitle(fn);r.setDescription("Download dari NEXORA");r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,fn);if(mime!=null&&!mime.isBlank())r.setMimeType(mime);if(ua!=null&&!ua.isBlank())r.addRequestHeader("User-Agent",ua);String cookies=CookieManager.getInstance().getCookie(url);if(cookies!=null&&!cookies.isBlank())r.addRequestHeader("Cookie",cookies);((DownloadManager)getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);Toast.makeText(this,"Download dimulai.",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(this,"Download gagal dimulai.",Toast.LENGTH_SHORT).show();}}
    private void loadOfflineFallback(){String offline="file:///android_asset/offline.html?target="+Uri.encode(startUrl());if(!offline.equals(webView.getUrl()))webView.loadUrl(offline);}
    @Override protected void onActivityResult(int rc,int result,Intent data){super.onActivityResult(rc,result,data);if(rc==FILE_CHOOSER_REQUEST&&fileChooserCallback!=null){Uri[] out=WebChromeClient.FileChooserParams.parseResult(result,data);fileChooserCallback.onReceiveValue(out);fileChooserCallback=null;}}
    @Override protected void onSaveInstanceState(Bundle out){webView.saveState(out);super.onSaveInstanceState(out);}
    @Override public void onBackPressed(){if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){if(fileChooserCallback!=null){fileChooserCallback.onReceiveValue(null);fileChooserCallback=null;}if(webView!=null){webView.stopLoading();webView.setWebChromeClient(null);webView.setWebViewClient(null);webView.destroy();}super.onDestroy();}
}
