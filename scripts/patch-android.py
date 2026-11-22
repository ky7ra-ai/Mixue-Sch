import glob, re
for f in glob.glob('android/app/src/main/res/values/styles.xml'):
    s = open(f).read()
    n = re.sub(r'(<style name="AppTheme\.NoActionBarLaunch"[^>]*>.*?<item name="android:background">)[^<]*(</item>)', r'\g<1>#E71D25\2', s, flags=re.S)
    if 'windowLightStatusBar' not in n:
        n = re.sub(r'(<style name="(?:AppTheme|AppTheme\.NoActionBar)"[^>]*>)', r'\1\n        <item name="android:windowLightStatusBar">true</item>', n)
    print('splash merah:', n != s, '| status bar gelap:', 'windowLightStatusBar' in n)
    open(f, 'w').write(n)
