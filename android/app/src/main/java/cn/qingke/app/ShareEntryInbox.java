package cn.qingke.app;

import java.util.LinkedList;

/** Bounded, thread-safe handoff between Activity intents and the trusted WebView bridge. */
final class ShareEntryInbox {
    static final int MAX_PENDING = 8;
    static final int MAX_RECENT = 32;
    static final class Entry {
        final ShareEntryPolicy.Link link;
        final String source;
        Entry(ShareEntryPolicy.Link link, String source) { this.link = link; this.source = source; }
    }
    private final LinkedList<Entry> pending = new LinkedList<>();
    private final LinkedList<String> recent = new LinkedList<>();

    synchronized void restoreRecent(String hashes) {
        recent.clear();
        if (hashes == null || hashes.length() > MAX_RECENT * 65) return;
        for (String id : hashes.split(",")) if (id.matches("[0-9a-f]{64}") && !recent.contains(id)) recent.add(id);
        while (recent.size() > MAX_RECENT) recent.removeFirst();
    }
    synchronized String recentState() { return String.join(",", recent); }

    synchronized boolean offer(ShareEntryPolicy.Link link, String source) {
        if (link == null || !("link".equals(source) || "clipboard".equals(source))) return false;
        boolean explicit = "link".equals(source);
        if (!explicit && recent.contains(link.id)) return false;
        for (int i = 0; i < pending.size(); i++) {
            Entry item = pending.get(i);
            if (!item.link.id.equals(link.id)) continue;
            if (!explicit || "link".equals(item.source)) return false;
            pending.remove(i); // An explicit tap supersedes a queued clipboard suggestion of the same share.
            break;
        }
        if (pending.size() == MAX_PENDING) {
            if (!explicit) return false;
            pending.removeLast(); // Preserve earlier explicit taps, evict a trailing clipboard suggestion first.
        }
        int index = 0;
        if (explicit) while (index < pending.size() && "link".equals(pending.get(index).source)) index++;
        else index = pending.size();
        pending.add(index, new Entry(link, source));
        remember(link);
        return true;
    }
    synchronized void remember(ShareEntryPolicy.Link link) {
        if (link == null) return;
        recent.remove(link.id);
        recent.addLast(link.id);
        while (recent.size() > MAX_RECENT) recent.removeFirst();
    }
    synchronized Entry poll() { return pending.pollFirst(); }
    synchronized boolean hasPending() { return !pending.isEmpty(); }
    synchronized boolean hasExplicit() {
        for (Entry item : pending) if ("link".equals(item.source)) return true;
        return false;
    }
    synchronized Entry[] snapshot() { return pending.toArray(new Entry[0]); }
    synchronized void dropClipboard() { pending.removeIf(item -> "clipboard".equals(item.source)); }

    synchronized void restorePending(String[] urls, String[] sources, boolean clipboardEnabled) {
        if (urls == null || sources == null || urls.length != sources.length || urls.length > MAX_PENDING) return;
        for (int i = 0; i < urls.length; i++) {
            ShareEntryPolicy.Link link = ShareEntryPolicy.parse(urls[i]);
            String source = sources[i];
            if (link == null || !("link".equals(source) || (clipboardEnabled && "clipboard".equals(source)))) continue;
            boolean duplicate = false;
            for (Entry item : pending) if (item.link.id.equals(link.id)) duplicate = true;
            if (!duplicate && pending.size() < MAX_PENDING) pending.add(new Entry(link, source));
        }
    }
}
