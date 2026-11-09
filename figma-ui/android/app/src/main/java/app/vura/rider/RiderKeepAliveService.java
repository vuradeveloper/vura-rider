package app.vura.rider;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Keeps the rider process at foreground-service priority while a scheduled ride
 * is close. Android freezes a backgrounded WebView's JS timers, which is exactly
 * where the scheduled-ride countdown, the driver-accepted poll and the live trip
 * map live. FCM still delivers the server pushes, but without this service the
 * app itself can be gone when the rider taps the notification.
 *
 * The service does no work of its own: the web layer starts it from 2 hours
 * before the earliest scheduled pickup and stops it when that ride is gone.
 */
public class RiderKeepAliveService extends Service {
    private static final String CHANNEL_ID = "vura_rider_scheduled";
    private static final int NOTIFICATION_ID = 84214;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Vura Ride — scheduled ride ready")
                .setContentText("Keeping the app ready so your pickup updates reach you.")
                .setSmallIcon(android.R.drawable.ic_menu_agenda)
                .setOngoing(true)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            // Never crash the rider over a notification; fall back to the
            // untyped call so the process still gets foreground priority.
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {
            }
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr != null && mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(new NotificationChannel(
                        CHANNEL_ID, "Scheduled rides", NotificationManager.IMPORTANCE_LOW));
            }
        }
    }
}
