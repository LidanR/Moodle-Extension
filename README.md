# Moodle JCT Redesign (Chrome Extension)

## Language / שפה
- [English](#english)
- [עברית](#hebrew)

---

<a name="english"></a>
## English

### Overview
A Chrome extension that modernizes and improves the usability of `moodle.jct.ac.il` with cleaner typography, better spacing, card-style course layout, and enhanced customization options.

### Features
- **Modern Design**: Updated fonts, colors, spacing, and shadows
- **Grid Card Layout**: Clean card-based layout for courses and blocks
- **Sticky Page Header**: Header remains visible while scrolling
- **Enhanced UI Elements**: Cleaner tables and buttons
- **RTL Support**: Full right-to-left support for Hebrew
- **Per-Year Color Accents**: Configurable color palette based on Hebrew year and semester

### Installation (Developer Mode)
1. Download this folder to your computer.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked** and select this folder (`Moodle-Extension`).
5. Visit `https://moodle.jct.ac.il/` and refresh the page.

**To update:** If the extension is already loaded, click the refresh icon on the extension card in `chrome://extensions/`.

### Customization Options

#### Year & Semester Color Palette �
1. Right-click the extension icon → **Options**, or open the extension card and click **Extension options**.
2. The color table shows Hebrew years (rows) and semesters (columns).
3. Pick colors for each combination. The extension automatically detects the year and semester from course titles.
4. Click **Save**, then reload the Moodle page to see your changes.
5. Click **Reset** to restore default colors.


### Advanced Customization
You can further customize the design by editing `styles.css`. Useful selectors:
- **Sidebar blocks**: `#block-region-side-pre .block`, `#nav-drawer`
- **Course cards**: `.coursebox`, `.block_myoverview .course`
- **Header**: `#page-header, header.navbar, .navbar`

### Uninstall
Remove the extension from `chrome://extensions/` or toggle it off.

---

<a name="hebrew"></a>
## עברית

### סקירה כללית
תוסף Chrome המשדרג ומשפר את חווית השימוש באתר `moodle.jct.ac.il` עם עיצוב מודרני, רווחים טובים יותר, מבנה כרטיסים לקורסים ואפשרויות התאמה אישית מתקדמות.

### תכונות עיקריות
- **עיצוב מודרני**: גופנים, צבעים, רווחים וצללים מעודכנים
- **מבנה רשת כרטיסים**: פריסת כרטיסים נקייה וברורה לקורסים ובלוקים
- **כותרת דביקה**: הכותרת נשארת גלויה בזמן גלילה
- **רכיבי ממשק משופרים**: טבלאות וכפתורים נקיים יותר
- **תמיכה מלאה ב-RTL**: מותאם לעברית מימין לשמאל
- **צבעים לפי שנה וסמסטר**: פלטת צבעים הניתנת להתאמה אישית לפי שנה עברית וסמסטר

### התקנה (מצב מפתח)
1. הורד תיקייה זו למחשב שלך.
2. פתח את Chrome ועבור אל `chrome://extensions/`.
3. הפעל את **מצב מפתח** (Developer mode) - המתג בפינה הימנית העליונה.
4. לחץ על **טען ללא אריזה** (Load unpacked) ובחר תיקייה זו (`Moodle-Extension`).
5. גש לכתובת `https://moodle.jct.ac.il/` ורענן את הדף.

**לעדכון:** אם התוסף כבר טעון, לחץ על אייקון הרענון בכרטיס התוסף ב-`chrome://extensions/`.

### אפשרויות התאמה אישית

#### פלטת צבעים לשנה וסמסטר 🎨
1. לחץ לחיצה ימנית על אייקון התוסף ← **אפשרויות** (Options), או פתח את כרטיס התוסף ולחץ **אפשרויות הרחבה**.
2. טבלת הצבעים מציגה שנים עבריות (שורות) וסמסטרים (עמודות).
3. בחר צבעים לכל שילוב. התוסף מזהה אוטומטית את השנה והסמסטר מכותרות הקורסים.
4. לחץ **שמירה**, ואז רענן את דף Moodle כדי לראות את השינויים.
5. לחץ **איפוס לברירת מחדל** כדי לחזור לצבעי ברירת המחדל.

### התאמה אישית מתקדמת
ניתן להתאים עוד יותר את העיצוב על ידי עריכת `styles.css`. סלקטורים שימושיים:
- **בלוקים בסרגל הצד**: `#block-region-side-pre .block`, `#nav-drawer`
- **כרטיסי קורס**: `.coursebox`, `.block_myoverview .course`
- **כותרת**: `#page-header, header.navbar, .navbar`

### הסרת התוסף
הסר את התוסף מ-`chrome://extensions/` או כבה אותו.
