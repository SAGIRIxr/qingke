package cn.qingke.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class ScheduleReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        // Loading a semester-sized local JSON and scheduling one alarm finishes synchronously.
        ScheduleNotifications.refresh(context, ScheduleNotifications.ACTION_TICK.equals(intent.getAction()));
    }
}
