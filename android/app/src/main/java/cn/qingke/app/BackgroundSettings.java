package cn.qingke.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import org.json.JSONException;
import org.json.JSONObject;

/** Read-only system diagnostics and user-initiated settings links; never grants a permission. */
final class BackgroundSettings {
    private BackgroundSettings() {}

    static String status(Context context) {
        JSONObject result = new JSONObject();
        try {
            result.put("supported", true);
            result.put("manufacturer", Build.MANUFACTURER);
            result.put("sdk", Build.VERSION.SDK_INT);
            // There is no public Android API for a vendor's autostart switch.
            result.put("autoStartStatus", "manual");
            result.put("batteryOptimizationIgnored", JSONObject.NULL);
            result.put("powerSave", JSONObject.NULL);
            result.put("backgroundRestricted", JSONObject.NULL);
            try {
                PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                if (power != null) {
                    result.put("batteryOptimizationIgnored", power.isIgnoringBatteryOptimizations(context.getPackageName()));
                    result.put("powerSave", power.isPowerSaveMode());
                }
            } catch (RuntimeException ignored) { /* Unknown is not the same as unrestricted. */ }
            if (Build.VERSION.SDK_INT >= 28) {
                try {
                    ActivityManager activity = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
                    if (activity != null) result.put("backgroundRestricted", activity.isBackgroundRestricted());
                } catch (RuntimeException ignored) { /* Some vendor builds do not expose this state. */ }
            }
        } catch (JSONException impossible) { return "{\"supported\":true}"; }
        return result.toString();
    }

    static boolean open(Activity activity, String action) {
        if (action == null) return false;
        String ownPackage = activity.getPackageName();
        switch (action) {
            case "autostart":
                // These two fixed MIUI/HyperOS components were verified on the target device.
                if (isXiaomi() && launch(activity, new Intent().setComponent(new ComponentName(
                        "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))) return true;
                break;
            case "battery":
                if (isXiaomi() && launch(activity, new Intent().setComponent(new ComponentName(
                        "com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"))
                        .putExtra("package_name", ownPackage)
                        .putExtra("package_label", activity.getApplicationInfo().loadLabel(activity.getPackageManager()).toString()))) return true;
                break;
            case "optimization":
                // Standard user-managed list: exact local alarms do not require a direct exemption request.
                if (launch(activity, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) return true;
                break;
            case "app":
                break;
            default:
                // No arbitrary action, package, component, extras or URI crosses the JS bridge.
                return false;
        }
        return launch(activity, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + ownPackage)));
    }

    private static boolean isXiaomi() {
        return "xiaomi".equalsIgnoreCase(Build.MANUFACTURER)
                || "redmi".equalsIgnoreCase(Build.MANUFACTURER)
                || "poco".equalsIgnoreCase(Build.MANUFACTURER);
    }

    private static boolean launch(Activity activity, Intent intent) {
        try {
            activity.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            return false;
        }
    }
}
