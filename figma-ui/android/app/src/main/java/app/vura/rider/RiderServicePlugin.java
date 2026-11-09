package app.vura.rider;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for the scheduled-ride keep-alive:
 *   RiderService.start()  → runs RiderKeepAliveService in the foreground
 *   RiderService.stop()   → stops it when no scheduled ride is close
 *
 * Both methods resolve even on failure so the web layer never has to guard a
 * native call (plain web builds have no service at all).
 */
@CapacitorPlugin(name = "RiderService")
public class RiderServicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Intent intent = new Intent(getContext(), RiderKeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            ret.put("started", true);
        } catch (Exception e) {
            ret.put("started", false);
            ret.put("error", String.valueOf(e.getMessage()));
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), RiderKeepAliveService.class));
        } catch (Exception ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }
}
