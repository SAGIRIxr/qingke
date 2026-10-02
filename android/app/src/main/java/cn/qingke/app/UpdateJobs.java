package cn.qingke.app;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Activity shutdown may race both executor submission and deadline submission. */
final class UpdateJobs {
    static void submit(ExecutorService worker, ScheduledExecutorService watchdog, long timeout,
                       Runnable onTimeout, Runnable operation, Runnable onUnavailable) {
        try {
            worker.execute(() -> {
                ScheduledFuture<?> timer = null;
                try {
                    timer = watchdog.schedule(onTimeout, timeout, TimeUnit.MILLISECONDS);
                    operation.run();
                } catch (RejectedExecutionException closed) {
                    onUnavailable.run();
                } finally {
                    if (timer != null) timer.cancel(false);
                }
            });
        } catch (RejectedExecutionException closed) {
            onUnavailable.run();
        }
    }
}
