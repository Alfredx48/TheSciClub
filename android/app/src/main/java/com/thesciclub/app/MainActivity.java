package com.thesciclub.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {

    // Capacitor asks for fine and coarse together, and before Android 12 a
    // refused fine means no location at all. The club only ever wants coarse.
    private String pendingOrigin;
    private GeolocationPermissions.Callback pendingCallback;

    private final ActivityResultLauncher<String> askCoarse = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(),
        (granted) -> {
            if (pendingCallback != null) pendingCallback.invoke(pendingOrigin, granted, false);
            pendingCallback = null;
            pendingOrigin = null;
        }
    );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidNotifications.class);
        super.onCreate(savedInstanceState);
        // No usable WebView: Capacitor has already shown its own notice.
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                String coarse = Manifest.permission.ACCESS_COARSE_LOCATION;
                if (ContextCompat.checkSelfPermission(MainActivity.this, coarse) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }
                // A prompt still waiting is answered no, never left hanging.
                if (pendingCallback != null) pendingCallback.invoke(pendingOrigin, false, false);
                pendingOrigin = origin;
                pendingCallback = callback;
                askCoarse.launch(coarse);
            }
        });
    }
}
