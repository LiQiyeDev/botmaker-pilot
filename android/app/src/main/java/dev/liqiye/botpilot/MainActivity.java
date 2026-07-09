package dev.liqiye.botpilot;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

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

        // Draw under the display cutout in landscape too, instead of letterboxing with the default (light)
        // window background — that letterbox is the "thick white border" seen when the phone is sideways.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }
}
