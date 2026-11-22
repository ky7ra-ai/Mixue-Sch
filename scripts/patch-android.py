import glob, re
for f in glob.glob('android/app/src/main/res/values/styles.xml'):
    s = open(f).read()
    n = re.sub(r'(<style name="AppTheme\.NoActionBarLaunch"[^>]*>.*?<item name="android:background">)[^<]*(</item>)', r'\g<1>#E71D25\2', s, flags=re.S)
    if 'windowLightStatusBar' not in n:
        n = re.sub(r'(<style name="(?:AppTheme|AppTheme\.NoActionBar)"[^>]*>)', r'\1\n        <item name="android:windowLightStatusBar">true</item>', n)
    print('splash merah:', n != s, '| status bar gelap:', 'windowLightStatusBar' in n)
    open(f, 'w').write(n)

# Background Runner (Android): folder pustaka + izin notifikasi
g = 'android/app/build.gradle'
t = open(g).read()
lib = "'../../node_modules/@capacitor/background-runner/android/src/main/libs'"
if lib not in t:
    t = re.sub(r"(flatDir\s*\{\s*dirs\s+)", r"\1" + lib + ", ", t, count=1)
open(g, 'w').write(t)
print('flatDir runner:', lib in t)
m = 'android/app/src/main/AndroidManifest.xml'
x = open(m).read()
for perm in ('android.permission.POST_NOTIFICATIONS', 'android.permission.SCHEDULE_EXACT_ALARM'):
    if perm not in x:
        x = x.replace('<application', '<uses-permission android:name="%s" />\n    <application' % perm, 1)
open(m, 'w').write(x)
print('izin notifikasi:', 'POST_NOTIFICATIONS' in x)
