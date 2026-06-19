package com.gohilinvestments.crm;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        bridge.getWebView().addJavascriptInterface(new NativeShareBridge(), "GohilNative");

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                bridge.getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('gi:android-back'))",
                    null
                );
            }
        });
    }

    private class NativeShareBridge {
        @JavascriptInterface
        public void shareBase64(String base64Data, String mimeType, String requestedName) {
            if (base64Data == null || base64Data.length() > 40_000_000) return;
            String safeName = requestedName == null ? "gohil-report" : requestedName.replaceAll("[^a-zA-Z0-9._-]", "_");
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                File shareDirectory = new File(getCacheDir(), "shared_reports");
                if (!shareDirectory.exists() && !shareDirectory.mkdirs()) return;
                File output = new File(shareDirectory, safeName);
                try (FileOutputStream stream = new FileOutputStream(output)) {
                    stream.write(bytes);
                }
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", output);
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType(mimeType == null ? "application/octet-stream" : mimeType);
                share.putExtra(Intent.EXTRA_STREAM, uri);
                share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(share, "Share report")));
            } catch (Exception ignored) {
                // Web code automatically falls back to the normal browser download path.
            }
        }
    }
}
