# Moodle JCT Redesign (Chrome Extension)

## Language / שפה
- [English](#english)
- [עברית](#hebrew)

---

<a name="english"></a>
## English

### Overview
A Chrome extension (Manifest V3) that modernizes and improves the usability of `moodle.jct.ac.il` with a clean course layout, weekly schedule & TODO dashboard, assignment/VPL scanner with grades, monthly calendar, and per-semester color themes.

### Features
- **Multiple Course Views & Card Styles**: Grid (3–6 columns), List, Semester Carousel, and Original views, with 5 card styles (`Compact`, `Minimal`, `Cards`, `Modern`, `Glass`).
- **Full Dark Mode (Light / Dark / Auto)**: Zero-flash dark theme across all Moodle pages (courses, quizzes, assignments, VPL, grades, forums, drawers) and all extension widgets, with a quick navbar toggle.
- **Per-Semester Color Accents**: 3 customizable colors (Elul, Semester A, Semester B) applied across all years, with automatic dual-color gradients for yearly courses.
- **Weekly Schedule & TODO Dashboard**: 7-day weekly timetable (Sunday–Saturday) with drag-and-drop course scheduling, weekly assignments/events overview, and built-in TODO list.
- **All Assignments & Grades Scanner**: Scans Moodle `assign` and `vpl` activities across selected courses, showing due dates, submission status, and gradebook grades with local caching.
- **Monthly Calendar**: Combines assignment due dates with personal custom events.
- **Full RTL Support**: Designed specifically for Hebrew Moodle at JCT.

### Installation (Developer Mode)
1. Download this folder to your computer.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right corner).
4. Click **Load unpacked** and select this folder (`Moodle-Extension`).
5. Visit `https://moodle.jct.ac.il/` and refresh the page.

**To update:** Click the refresh icon on the extension card in `chrome://extensions/`.

### Project Structure
```text
├── manifest.json
├── background.js
├── assets/
├── tools/
└── src/
    ├── css/
    │   ├── base.css          # Base typography, layout, page header, animations
    │   ├── courses.css       # Course grid, view modes, and card styles
    │   ├── course-page.css   # Course page theming & My Courses page
    │   ├── schedule.css      # Weekly schedule, TODO column, schedule modals
    │   └── modals.css        # Assignments, settings, warning & calendar modals
    └── js/
        ├── config.js         # Shared constants and runtime state
        ├── utils.js          # HTML escaping, date/Hebrew parsing, color helpers
        ├── storage.js        # Chrome storage & cache helpers
        ├── courses.js        # Course cards, favorites, views & course page colors
        ├── schedule.js       # Weekly schedule, drag & drop & TODO list
        ├── assignments.js    # Assignment/VPL scanner & gradebook fetcher
        ├── main.js           # Entry point, action buttons & observers
        └── modals/
            ├── settings-modal.js
            ├── assignments-modal.js
            └── calendar-modal.js
```

### Customization
Click the **⚙️ אפשרויות** button on the Moodle home page to configure colors per Hebrew year & semester, course view mode, card style, and grid column count.

---

<a name="hebrew"></a>
## עברית

### סקירה כללית
תוסף Chrome (Manifest V3) המשדרג את חוויית השימוש ב-`moodle.jct.ac.il` עם פריסת קורסים מודרנית, מערכת שעות שבועית ורשימת משימות, סורק מטלות וציונים (כולל VPL), לוח שנה חודשי וצבעים לפי שנה וסמסטר.

### תכונות עיקריות
- **תצוגות קורסים ועיצובי כרטיסים**: תצוגת בלוקים (3–6 עמודות), רשימה, קרוסלה לפי סמסטר או תצוגה מקורית, ב-5 סגנונות עיצוב.
- **מצב כהה מלא (בהיר / כהה / אוטומטי)**: Dark Mode ללא הבהוב לבן בכל עמודי Moodle (קורסים, בחנים, מטלות, VPL, ציונים, פורומים, תפריטי צד) ובכל חלונות התוסף, כולל כפתור מעבר מהיר בסרגל העליון.
- **צבעים לפי סמסטר**: 3 צבעים לבחירה (אלול, סמסטר א', סמסטר ב') החלים על כל השנים ללא הגבלת תוקף, כולל שילוב צבעים אוטומטי לקורסים שנתיים.
- **מערכת שעות שבועית ו-TODO**: מערכת ל-7 ימים (ראשון–שבת) עם גרירת קורסים, הצגת מטלות ואירועים לאותו שבוע ורשימת משימות מובנית.
- **סריקת מטלות וציונים**: סריקה של מטלות רגילות ו-VPL לפי שנה, סמסטר ובחירת קורסים, כולל סטטוס הגשה וציונים מגיליון הציונים.
- **לוח שנה חודשי**: שילוב תאריכי הגשה של מטלות ואירועים אישיים.
- **תמיכה מלאה ב-RTL**: מותאם לעברית מימין לשמאל.

### התקנה (מצב מפתח)
1. הורד תיקייה זו למחשב שלך.
2. פתח את Chrome ועבור אל `chrome://extensions/`.
3. הפעל את **מצב מפתח** (Developer mode) בפינה העליונה.
4. לחץ על **טען ללא אריזה** (Load unpacked) ובחר את תיקיית הפרויקט (`Moodle-Extension`).
5. גש אל `https://moodle.jct.ac.il/` ורענן את הדף.

### התאמה אישית
לחץ על כפתור **⚙️ אפשרויות** בראש דף הבית של Moodle כדי להתאים את פלטת הצבעים, תצוגת הקורסים, עיצוב הכרטיסים ומספר העמודות.
