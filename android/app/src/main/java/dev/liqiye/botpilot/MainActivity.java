package dev.liqiye.botpilot;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Capacitor bridge activity. We proactively request the runtime CAMERA permission on launch so the WebView's
 * getUserMedia (used by the in-app QR scanner) is grantable — Capacitor's WebChromeClient will approve the
 * WebView camera resource once the app-level permission is held.
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_CAMERA = 4321;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }
}
