# Permissions Justification

## Storage Permission

**Justification:**
The extension requires the `storage` permission to persist user preferences and data across browser sessions. Specifically, it uses `chrome.storage.sync` and `chrome.storage.local` to:

1. **Save user color palette preferences** - Users can customize course colors by Hebrew year and semester, and these preferences need to be saved and restored when they return to Moodle.

2. **Store course schedules** - The extension allows users to create and manage weekly course schedules by dragging courses to specific days and times. This schedule data must be persisted so users don't lose their organization when they close the browser.

3. **Cache assignment data** - To improve performance and reduce API calls, the extension caches assignment information (due dates, submission status) for each course. This cache is stored locally and expires after 5 minutes to ensure data freshness.

4. **Remember favorite courses** - Users can mark courses as favorites, and this preference is saved to storage.

5. **Store assignment tracking settings** - The extension saves user preferences for how long overdue assignments should be displayed before being hidden.

All data is stored locally in the user's browser and is never transmitted to any external servers. The extension only uses Chrome's built-in storage API and does not access any files on the user's system.

## Host Permissions (https://moodle.jct.ac.il/*)

**Justification:**
The extension requires host permissions for `https://moodle.jct.ac.il/*` to:

1. **Enhance the Moodle interface** - The extension injects CSS styles and JavaScript to improve the visual design and usability of the Moodle platform, including:
   - Modern card-based course layout
   - Improved typography and spacing
   - Custom color schemes based on course year and semester
   - Enhanced UI elements (buttons, tables, forms)

2. **Fetch assignment data** - The extension needs to make API calls to Moodle's AJAX endpoints (`core_course_get_contents`) to retrieve assignment information including:
   - Assignment names and IDs
   - Due dates
   - Submission status
   - Assignment URLs

3. **Parse course content** - When API calls are not available, the extension fetches course pages to parse HTML and extract assignment information, ensuring the assignment tracking feature works reliably.

4. **Access assignment pages** - To determine if an assignment has been submitted, the extension may fetch individual assignment pages to check submission status indicators in the page content.

All network requests are made only to `moodle.jct.ac.il` (the official JCT Moodle instance) and use the user's existing authentication cookies. The extension does not access any other websites or domains, and all data processing happens locally in the browser.

## Remote Code Execution

**Status:** Not applicable

The extension does **not** use any remote code execution. All JavaScript code is bundled locally in the extension package:
- `content.js` - Runs on Moodle pages to enhance the UI
- `options.js` - Handles the options/settings page
- `background.js` - Service worker for handling extension events
- `styles.css` - Local CSS styles

No code is fetched from external servers, and no `eval()` or similar dynamic code execution is used. All functionality is implemented using static, locally-bundled code that is reviewed and included in the extension package.

