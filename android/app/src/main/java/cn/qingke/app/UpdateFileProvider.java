package cn.qingke.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Read-only URI grants for one hash-named, private verified APK; never a general file provider. */
public final class UpdateFileProvider extends ContentProvider {
    static final String AUTHORITY = "cn.qingke.app.updates";
    @Override public boolean onCreate() { return true; }
    private File file(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (!"content".equals(uri.getScheme()) || !AUTHORITY.equals(uri.getAuthority()) || uri.getPathSegments().size() != 1
                || uri.getQuery() != null || uri.getFragment() != null || name == null || !name.matches("[a-f0-9]{64}\\.apk")) throw new FileNotFoundException("Invalid update URI");
        File directory = new File(getContext().getFilesDir(), "updates"), file = new File(directory, name);
        try { if (!file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile()) || !file.isFile()) throw new IOException(); }
        catch (IOException error) { throw new FileNotFoundException("Update is unavailable"); }
        return file;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read-only update");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public String getType(Uri uri) { return "application/vnd.android.package-archive"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        try {
            File file = file(uri);
            String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor result = new MatrixCursor(columns, 1); Object[] values = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) values[i] = OpenableColumns.DISPLAY_NAME.equals(columns[i]) ? "qingke-update.apk" : OpenableColumns.SIZE.equals(columns[i]) ? file.length() : null;
            result.addRow(values); return result;
        } catch (FileNotFoundException error) { return null; }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read-only update"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read-only update"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read-only update"); }
}
