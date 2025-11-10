// Hebrew year strings mapped to gregorian year
const HEBREW_YEARS = [
	{str:"תשפ\"ד", num:5784}, {str:"תשפ\"ה", num:5785}, {str:"תשפ\"ו", num:5786},
	{str:"תשפ\"ז", num:5787}, {str:"תשפ\"ח", num:5788}, {str:"תשפ\"ט", num:5789}, {str:"תש\"צ", num:5790}
];
const SEMESTERS = ["אלול","א","ב"];

const DEFAULT_PALETTE = [
	["#3b82f6","#818cf8","#bae6fd"], // 5784
	["#22c55e","#4ade80","#bbf7d0"], // 5785
	["#f97316","#fbbf24","#fed7aa"], // 5786
	["#f43f5e","#fda4af","#fecdd3"], // 5787
	["#a21caf","#f472b6","#f3e8ff"], // 5788
	["#2563eb","#60a5fa","#dbeafe"], // 5789
	["#b45309","#f59e42","#fde68a"]  // 5790
];

const DEFAULT_COLUMN_COUNT = 3;

// === Storage helpers ===
function getSettingsFromStorage() {
	return new Promise(resolve => {
		chrome.storage.sync.get({ 
			paletteByYearHeb: null,
			columnCount: DEFAULT_COLUMN_COUNT,
			courseSchedules: {},
			maxOverdueDays: 30
		}, res => resolve(res));
	});
}

function saveSettingsToStorage(palette, columnCount, courseSchedules, maxOverdueDays) {
	return new Promise(resolve => {
		chrome.storage.sync.set({ 
			paletteByYearHeb: palette,
			columnCount: columnCount,
			courseSchedules: courseSchedules || {},
			maxOverdueDays: maxOverdueDays || 30
		}, () => resolve());
	});
}

function getCourseSchedules() {
	return new Promise(resolve => {
		chrome.storage.sync.get({ courseSchedules: {} }, res => {
			resolve(res.courseSchedules || {});
		});
	});
}

function saveCourseSchedules(schedules) {
	return new Promise(resolve => {
		chrome.storage.sync.set({ courseSchedules: schedules }, () => resolve());
	});
}

// === UI rendering ===
async function render() {
	const tb = document.getElementById('palette-table');
	const { paletteByYearHeb, columnCount, maxOverdueDays } = await getSettingsFromStorage();
	const palette = Array.isArray(paletteByYearHeb) ? paletteByYearHeb : DEFAULT_PALETTE;

	let html = '<tr><th>שנה\\סמסטר</th>';
	for (let sem of SEMESTERS) html += `<th>${sem}</th>`;
	html += '</tr>';
	for (let r = 0; r < HEBREW_YEARS.length; ++r) {
		html += `<tr><td label="year"><b>${HEBREW_YEARS[r].str}</b></td>`;
		for (let c = 0; c < SEMESTERS.length; ++c) {
			html += `<td><input type="color" id="c_${r}_${c}" value="${palette[r][c]}"></td>`;
		}
		html += '</tr>';
	}
	tb.innerHTML = html;

	// Set column count input
	document.getElementById('columnCount').value = columnCount;
	
	// Set max overdue days input
	document.getElementById('maxOverdueDays').value = maxOverdueDays || 30;
}

// === Read from UI ===
function readPaletteFromUI() {
	const palette = [];
	for (let r = 0; r < HEBREW_YEARS.length; ++r) {
		palette[r] = [];
		for (let c = 0; c < SEMESTERS.length; ++c) {
			palette[r][c] = (document.getElementById(`c_${r}_${c}`) || {}).value || "#cccccc";
		}
	}
	return palette;
}

// === Handlers ===
document.getElementById('save').addEventListener('click', async () => {
	const palette = readPaletteFromUI();
	const columnCount = Math.max(3, Math.min(6, parseInt(document.getElementById('columnCount').value || 3)));
	const maxOverdueDays = Math.max(0, parseInt(document.getElementById('maxOverdueDays').value || 30));
	await saveSettingsToStorage(palette, columnCount, null, maxOverdueDays);
	alert('נשמר! רענן את העמוד כדי לראות את השינוי.');
});

document.getElementById('reset').addEventListener('click', async () => {
	await saveSettingsToStorage(DEFAULT_PALETTE, DEFAULT_COLUMN_COUNT, {}, 30);
	await render();
});

render();
