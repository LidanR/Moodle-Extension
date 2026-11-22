(function (JCT) {
	'use strict';

	const {
		SEMESTERS,
		DEFAULT_SEMESTER_COLORS,
		DEFAULT_HEADER_GRADIENT,
		HEADER_GRADIENT_PRESETS,
		DEFAULT_COLUMN_COUNT
	} = JCT.config;

	const THEME_OPTIONS = [
		{ id: 'light', icon: '☀️', label: 'בהיר' },
		{ id: 'dark', icon: '🌙', label: 'כהה' },
		{ id: 'auto', icon: '🖥️', label: 'אוטומטי' }
	];

	async function showSettingsModal() {
		if (document.querySelector('.jct-settings-modal-root')) return;

		const settings = await JCT.storage.storageGet('sync', {
			themeMode: 'light',
			headerGradient: null,
			semesterColors: null,
			columnCount: DEFAULT_COLUMN_COUNT,
			viewMode: 'grid',
			cardStyle: 'compact'
		});

		const colors =
			Array.isArray(settings.semesterColors) && settings.semesterColors.length >= 3
				? settings.semesterColors
				: DEFAULT_SEMESTER_COLORS.slice();
		const gradient =
			Array.isArray(settings.headerGradient) && settings.headerGradient.length >= 2
				? [settings.headerGradient[0], settings.headerGradient[1]]
				: DEFAULT_HEADER_GRADIENT.slice();
		const columnCount = settings.columnCount || DEFAULT_COLUMN_COUNT;
		const viewMode = settings.viewMode || 'grid';
		const cardStyle = settings.cardStyle || 'compact';
		let selectedTheme = settings.themeMode || 'light';

		const themeOptionsHtml = THEME_OPTIONS.map((t) => `
			<button type="button" class="jct-theme-option${t.id === selectedTheme ? ' active' : ''}" data-theme="${t.id}">
				<span>${t.icon}</span>
				<span>${t.label}</span>
			</button>
		`).join('');

		const isPresetMatch = (p) =>
			p.colors[0].toLowerCase() === gradient[0].toLowerCase() &&
			p.colors[1].toLowerCase() === gradient[1].toLowerCase();

		const gradientPresetsHtml = HEADER_GRADIENT_PRESETS.map((p) => `
			<button type="button" class="jct-gradient-preset-btn${isPresetMatch(p) ? ' active' : ''}" data-start="${p.colors[0]}" data-end="${p.colors[1]}" title="${p.name}" style="background: linear-gradient(135deg, ${p.colors[0]} 0%, ${p.colors[1]} 100%);"></button>
		`).join('');

		const semesterCardsHtml = SEMESTERS.map((sem) => {
			const val = colors[sem.idx] || DEFAULT_SEMESTER_COLORS[sem.idx];
			return `
				<label class="jct-semester-color-card" for="jct-sem-color-${sem.idx}">
					<span class="jct-semester-color-swatch" id="jct-sem-swatch-${sem.idx}" style="background: ${val};">
						<input type="color" id="jct-sem-color-${sem.idx}" value="${val}">
					</span>
					<span class="jct-semester-color-label">${sem.fullLabel}</span>
				</label>
			`;
		}).join('');

		const modal = document.createElement('div');
		modal.className = 'jct-assignments-modal jct-settings-modal-root';
		modal.innerHTML = `
			<div class="jct-assignments-modal-content jct-settings-modal-compact">
				<div class="jct-assignments-modal-header jct-settings-modal-header">
					<h3>⚙️ הגדרות</h3>
					<button type="button" class="jct-assignments-modal-close">✕</button>
				</div>

				<div class="jct-settings-modal-body">
					<section class="jct-settings-section">
						<h4 class="jct-settings-section-title">🌓 ערכת נושא</h4>
						<div class="jct-theme-picker">
							${themeOptionsHtml}
						</div>
					</section>

					<section class="jct-settings-section">
						<h4 class="jct-settings-section-title">🌈 צבע כותרת וגרדיאנט</h4>
						<div class="jct-gradient-presets">
							${gradientPresetsHtml}
						</div>
						<div class="jct-gradient-custom-row">
							<label class="jct-gradient-color-input" for="jct-grad-start">
								<span class="jct-mini-swatch" id="jct-grad-start-swatch" style="background:${gradient[0]};">
									<input type="color" id="jct-grad-start" value="${gradient[0]}">
								</span>
								<span>צבע התחלה</span>
							</label>
							<label class="jct-gradient-color-input" for="jct-grad-end">
								<span class="jct-mini-swatch" id="jct-grad-end-swatch" style="background:${gradient[1]};">
									<input type="color" id="jct-grad-end" value="${gradient[1]}">
								</span>
								<span>צבע סיום</span>
							</label>
						</div>
					</section>

					<section class="jct-settings-section">
						<h4 class="jct-settings-section-title">🎨 צבעי סמסטרים</h4>
						<div class="jct-semester-colors-grid">
							${semesterCardsHtml}
						</div>
						<div class="jct-yearly-preview-note">
							<span class="jct-yearly-preview-bar" id="jct-yearly-preview-bar" style="background: linear-gradient(90deg, ${colors[1]}, ${colors[2]});"></span>
							<span>קורסים שנתיים משלבים אוטומטית את צבעי סמסטר א׳ וב׳</span>
						</div>
					</section>

					<section class="jct-settings-section">
						<h4 class="jct-settings-section-title">⚡ הגדרות תצוגה</h4>
						<div class="jct-settings-fields">
							<label class="jct-settings-field">
								<span>תצוגת קורסים</span>
								<select id="jct-view-mode" class="jct-settings-select">
									<option value="grid" ${viewMode === 'grid' ? 'selected' : ''}>🔲 בלוקים</option>
									<option value="list" ${viewMode === 'list' ? 'selected' : ''}>📋 רשימה</option>
									<option value="original" ${viewMode === 'original' ? 'selected' : ''}>📄 מקורי</option>
									<option value="carousel" ${viewMode === 'carousel' ? 'selected' : ''}>🎠 קלפים</option>
								</select>
							</label>

							<label class="jct-settings-field">
								<span>עיצוב כרטיסים</span>
								<select id="jct-card-style" class="jct-settings-select">
									<option value="compact" ${cardStyle === 'compact' ? 'selected' : ''}>📦 קומפקטי</option>
									<option value="minimal" ${cardStyle === 'minimal' ? 'selected' : ''}>✨ מינימליסטי</option>
									<option value="cards" ${cardStyle === 'cards' ? 'selected' : ''}>🎴 כרטיסים</option>
									<option value="modern" ${cardStyle === 'modern' ? 'selected' : ''}>🚀 מודרני</option>
									<option value="glass" ${cardStyle === 'glass' ? 'selected' : ''}>💎 זכוכית</option>
								</select>
							</label>

							<label class="jct-settings-field" id="jct-column-count-row">
								<span>עמודות בבלוקים <small>(3–6)</small></span>
								<input id="jct-column-count" type="number" min="3" max="6" step="1" value="${columnCount}" class="jct-settings-number">
							</label>
						</div>
					</section>
				</div>

				<div class="jct-settings-modal-footer">
					<button type="button" id="jct-settings-save" class="jct-settings-save-btn">💾 שמור שינויים</button>
					<button type="button" id="jct-settings-reset" class="jct-settings-reset-btn">🔄 איפוס</button>
				</div>
			</div>
		`;
		document.body.appendChild(modal);

		const closeModal = () => {
			modal.remove();
			JCT.schedule.updateWeeklyScheduleView();
		};

		modal.querySelector('.jct-assignments-modal-close').addEventListener('click', closeModal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) closeModal();
		});

		// Theme switching
		const themeButtons = modal.querySelectorAll('.jct-theme-option');
		themeButtons.forEach((btn) => {
			btn.addEventListener('click', () => {
				selectedTheme = btn.dataset.theme;
				themeButtons.forEach((b) => b.classList.toggle('active', b === btn));
				JCT.theme.setThemeMode(selectedTheme);
			});
		});

		// Header gradient picker (presets + custom pickers with live preview)
		const gradStartInput = modal.querySelector('#jct-grad-start');
		const gradEndInput = modal.querySelector('#jct-grad-end');
		const gradStartSwatch = modal.querySelector('#jct-grad-start-swatch');
		const gradEndSwatch = modal.querySelector('#jct-grad-end-swatch');
		const presetButtons = modal.querySelectorAll('.jct-gradient-preset-btn');

		const syncGradientUI = (startHex, endHex, applyLive = true) => {
			gradStartInput.value = startHex;
			gradEndInput.value = endHex;
			gradStartSwatch.style.background = startHex;
			gradEndSwatch.style.background = endHex;
			presetButtons.forEach((b) => {
				const match =
					b.dataset.start.toLowerCase() === startHex.toLowerCase() &&
					b.dataset.end.toLowerCase() === endHex.toLowerCase();
				b.classList.toggle('active', match);
			});
			if (applyLive) {
				JCT.theme.applyHeaderGradient([startHex, endHex]);
			}
		};

		presetButtons.forEach((btn) => {
			btn.addEventListener('click', () => {
				syncGradientUI(btn.dataset.start, btn.dataset.end, true);
			});
		});

		gradStartInput.addEventListener('input', () => syncGradientUI(gradStartInput.value, gradEndInput.value, true));
		gradEndInput.addEventListener('input', () => syncGradientUI(gradStartInput.value, gradEndInput.value, true));

		// Semester color previews
		const yearlyBar = modal.querySelector('#jct-yearly-preview-bar');
		const updateColorPreviews = () => {
			SEMESTERS.forEach((sem) => {
				const input = modal.querySelector(`#jct-sem-color-${sem.idx}`);
				const swatch = modal.querySelector(`#jct-sem-swatch-${sem.idx}`);
				if (input && swatch) swatch.style.background = input.value;
			});
			const cA = modal.querySelector('#jct-sem-color-1')?.value || DEFAULT_SEMESTER_COLORS[1];
			const cB = modal.querySelector('#jct-sem-color-2')?.value || DEFAULT_SEMESTER_COLORS[2];
			if (yearlyBar) yearlyBar.style.background = `linear-gradient(90deg, ${cA}, ${cB})`;
		};

		SEMESTERS.forEach((sem) => {
			modal.querySelector(`#jct-sem-color-${sem.idx}`)?.addEventListener('input', updateColorPreviews);
		});

		const viewModeSelect = modal.querySelector('#jct-view-mode');
		const colRow = modal.querySelector('#jct-column-count-row');
		const toggleColRow = () => {
			if (colRow) colRow.style.opacity = viewModeSelect.value === 'grid' ? '1' : '0.45';
		};
		viewModeSelect.addEventListener('change', toggleColRow);
		toggleColRow();

		const saveBtn = modal.querySelector('#jct-settings-save');
		const resetBtn = modal.querySelector('#jct-settings-reset');

		saveBtn.addEventListener('click', async () => {
			const newColors = SEMESTERS.map(
				(sem) => modal.querySelector(`#jct-sem-color-${sem.idx}`)?.value || DEFAULT_SEMESTER_COLORS[sem.idx]
			);
			const newGradient = [
				gradStartInput.value || DEFAULT_HEADER_GRADIENT[0],
				gradEndInput.value || DEFAULT_HEADER_GRADIENT[1]
			];

			const parsedCols = parseInt(modal.querySelector('#jct-column-count').value || String(DEFAULT_COLUMN_COUNT), 10);
			const newColumnCount = Math.max(3, Math.min(6, isNaN(parsedCols) ? DEFAULT_COLUMN_COUNT : parsedCols));
			const newViewMode = viewModeSelect.value || 'grid';
			const newCardStyle = modal.querySelector('#jct-card-style').value || 'compact';

			JCT.state.semesterColors = newColors;
			JCT.state.currentColumnCount = newColumnCount;

			await JCT.storage.storageSet('sync', {
				themeMode: selectedTheme,
				headerGradient: newGradient,
				semesterColors: newColors,
				columnCount: newColumnCount,
				viewMode: newViewMode,
				cardStyle: newCardStyle
			});

			JCT.theme.applyTheme(selectedTheme);
			JCT.theme.applyHeaderGradient(newGradient);
			document.documentElement.style.setProperty('--jct-columns', String(newColumnCount));
			JCT.courses.applyViewMode(newViewMode);
			JCT.courses.applyCardStyle(newCardStyle);
			JCT.courses.ensureStructureAndColor();
			JCT.courses.applyCoursePageColors();

			const originalText = saveBtn.textContent;
			saveBtn.textContent = '✓ נשמר!';
			saveBtn.classList.add('saved');
			setTimeout(() => {
				saveBtn.textContent = originalText;
				saveBtn.classList.remove('saved');
			}, 1800);
		});

		resetBtn.addEventListener('click', async () => {
			const defaultColors = DEFAULT_SEMESTER_COLORS.slice();
			const defaultGrad = DEFAULT_HEADER_GRADIENT.slice();
			selectedTheme = 'light';
			JCT.state.semesterColors = defaultColors;
			JCT.state.currentColumnCount = DEFAULT_COLUMN_COUNT;

			await JCT.storage.storageSet('sync', {
				themeMode: 'light',
				headerGradient: defaultGrad,
				semesterColors: defaultColors,
				columnCount: DEFAULT_COLUMN_COUNT,
				viewMode: 'grid',
				cardStyle: 'compact'
			});

			themeButtons.forEach((b) => b.classList.toggle('active', b.dataset.theme === 'light'));
			JCT.theme.applyTheme('light');
			syncGradientUI(defaultGrad[0], defaultGrad[1], true);

			SEMESTERS.forEach((sem) => {
				const input = modal.querySelector(`#jct-sem-color-${sem.idx}`);
				if (input) input.value = defaultColors[sem.idx];
			});
			updateColorPreviews();

			modal.querySelector('#jct-column-count').value = String(DEFAULT_COLUMN_COUNT);
			viewModeSelect.value = 'grid';
			modal.querySelector('#jct-card-style').value = 'compact';
			toggleColRow();

			document.documentElement.style.setProperty('--jct-columns', String(DEFAULT_COLUMN_COUNT));
			JCT.courses.applyViewMode('grid');
			JCT.courses.applyCardStyle('compact');
			JCT.courses.ensureStructureAndColor();
			JCT.courses.applyCoursePageColors();
		});
	}

	JCT.modals = JCT.modals || {};
	JCT.modals.showSettingsModal = showSettingsModal;
})(window.JCT = window.JCT || {});
