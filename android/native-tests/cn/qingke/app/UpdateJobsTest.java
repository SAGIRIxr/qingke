package cn.qingke.app;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public final class UpdateJobsTest {
    private static int checks;
    private static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    public static void main(String[]args)throws Exception{
        ExecutorService stopped=Executors.newSingleThreadExecutor();ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
        stopped.shutdownNow();AtomicBoolean fallback=new AtomicBoolean();
        UpdateJobs.submit(stopped,timer,1000,()->{},()->{throw new AssertionError("closed worker ran operation");},()->fallback.set(true));
        check(fallback.get(),"Closing before worker submission is a normal cancellation");timer.shutdownNow();

        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),completed=new CountDownLatch(1);
        AtomicReference<Throwable> uncaught=new AtomicReference<>();AtomicBoolean ranOperation=new AtomicBoolean();
        ThreadPoolExecutor worker=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new LinkedBlockingQueue<>(),r->{Thread t=new Thread(r);t.setUncaughtExceptionHandler((thread,error)->uncaught.set(error));return t;}){
            @Override protected void beforeExecute(Thread thread,Runnable task){entered.countDown();boolean waiting=true;while(waiting)try{release.await();waiting=false;}catch(InterruptedException ignored){}}
        };
        ScheduledExecutorService watchdog=Executors.newSingleThreadScheduledExecutor();
        UpdateJobs.submit(worker,watchdog,1000,()->{},()->ranOperation.set(true),completed::countDown);
        check(entered.await(2,TimeUnit.SECONDS),"Worker reached controlled deadline-submission boundary");
        worker.shutdownNow();watchdog.shutdownNow();release.countDown();
        check(completed.await(2,TimeUnit.SECONDS),"Closing watchdog after worker begins is caught");worker.awaitTermination(2,TimeUnit.SECONDS);
        check(uncaught.get()==null&&!ranOperation.get(),"Activity shutdown does not crash a background thread or execute work");

        ExecutorService normal=Executors.newSingleThreadExecutor();ScheduledExecutorService normalTimer=Executors.newSingleThreadScheduledExecutor();
        CountDownLatch finished=new CountDownLatch(1);AtomicBoolean lateTimeout=new AtomicBoolean();
        UpdateJobs.submit(normal,normalTimer,100,()->lateTimeout.set(true),finished::countDown,()->{throw new AssertionError("unexpected rejection");});
        check(finished.await(2,TimeUnit.SECONDS),"Normal work executes");normal.shutdown();normal.awaitTermination(2,TimeUnit.SECONDS);
        CountDownLatch afterDeadline=new CountDownLatch(1);normalTimer.schedule(afterDeadline::countDown,150,TimeUnit.MILLISECONDS);afterDeadline.await(2,TimeUnit.SECONDS);
        check(!lateTimeout.get(),"Completed task cancels its deadline");normalTimer.shutdownNow();
        System.out.println("PASS: "+checks+" update lifecycle checks");
    }
}
