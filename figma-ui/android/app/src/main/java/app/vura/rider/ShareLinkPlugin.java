package app.vura.rider;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native clipboard + Android share chooser for the trip link.
 *
 * The WebView's navigator.clipboard frequently rejects in the Capacitor shell,
 * and navigator.share does not exist there, so the old "Copy link" button could
 * report success without copying and never opened WhatsApp/SMS/email.
 *
 * Implemented locally (Java 17) instead of @capacitor/share 8.x, whose Android
 * module requires a Java 21 toolchain that this build machine does not have.
 */
@CapacitorPlugin(name = "ShareLink")
public class ShareLinkPlugin extends Plugin {

    @PluginMethod
    public void copy(PluginCall call) {
        String text = call.getString("text", "");
        JSObject ret = new JSObject();
        if (text.isEmpty()) {
            ret.put("copied", false);
            call.resolve(ret);
            return;
        }
        try {
            ClipboardManager cm = (ClipboardManager) getContext()
                    .getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) {
                ret.put("copied", false);
                call.resolve(ret);
                return;
            }
            cm.setPrimaryClip(ClipData.newPlainText("Vura trip link", text));
            ret.put("copied", true);
        } catch (Exception e) {
            ret.put("copied", false);
            ret.put("error", String.valueOf(e.getMessage()));
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void share(PluginCall call) {
        String url = call.getString("url", "");
        String title = call.getString("title", "Track my Vura ride");
        String text = call.getString("text", "Follow my trip live:");
        JSObject ret = new JSObject();
        if (url.isEmpty()) {
            ret.put("shared", false);
            call.resolve(ret);
            return;
        }
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.putExtra(Intent.EXTRA_TEXT, text + "\n" + url);
            Intent chooser = Intent.createChooser(send, "Share your trip link");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            ret.put("shared", true);
        } catch (Exception e) {
            ret.put("shared", false);
            ret.put("error", String.valueOf(e.getMessage()));
        }
        call.resolve(ret);
    }
}
