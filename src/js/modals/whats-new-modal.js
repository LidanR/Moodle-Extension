(function (JCT) {
	'use strict';

	const SEEN_VERSION_KEY = 'jctLastSeenVersion';

	function getExtensionVersion() {
		try {
			return chrome.runtime.getManifest().version || '2.4.0';
		} catch (_e) {
			return '2.4.0';
		}
	}

	async function markVersionSeen(version) {
		await JCT.storage.storageSet('local', { [SEEN_VERSION_KEY]: version });
	}

	function showWhatsNewModal(version = getExtensionVersion()) {
		if (document.querySelector('.jct-whats-new-modal')) return;

		const isDarkNow = JCT.theme.getEffectiveTheme() === 'dark';

		const modal = document.createElement('div');
		modal.className = 'jct-assignments-modal jct-whats-new-modal';
		modal.innerHTML = `
			<div class="jct-assignments-modal-content jct-whats-new-card">
				<div class="jct-assignments-modal-header jct-settings-modal-header">
					<div>
						<span class="jct-whats-new-badge">גרסה ${version}</span>
						<h3>✨ מה חדש בתוסף?</h3>
					</div>
					<button type="button" class="jct-assignments-modal-close">✕</button>
				</div>

				<div class="jct-whats-new-body">
					<div class="jct-whats-new-item">
						<div class="jct-whats-new-icon">🌙</div>
						<div class="jct-whats-new-text">
							<div class="jct-whats-new-title-row">
								<strong>מצב כהה מלא (Dark Mode)</strong>
								<button type="button" id="jct-wn-toggle-dark" class="jct-wn-try-btn">
									${isDarkNow ? '☀️ נסה בהיר' : '🌙 נסה עכשיו'}
								</button>
							</div>
							<p>עיצוב כהה לכל עמודי המודל, כולל כפתור מעבר מהיר בסרגל העליון ובחירת מצב אוטומטי.</p>
						</div>
					</div>

					<div class="jct-whats-new-item">
						<div class="jct-whats-new-icon">✅</div>
						<div class="jct-whats-new-text">
							<strong>תפריט משימות חדש ב-TODO</strong>
							<p>לחיצה על כפתור ה-<code>+</code> בעמודת ה-TODO פותחת תפריט מסודר עם בחירת אייקון, צבע ועדיפות לכל משימה.</p>
						</div>
					</div>

					<div class="jct-whats-new-item">
						<div class="jct-whats-new-icon">⚙️</div>
						<div class="jct-whats-new-text">
							<strong>חידושים בתפריט האפשרויות</strong>
							<p>תפריט הגדרות קומפקטי עם החלפת צבע הגרדיאנט של הדף ו-3 צבעי סמסטר פשוטים לכל השנים.</p>
						</div>
					</div>
				</div>

				<div class="jct-whats-new-footer">
					<button type="button" id="jct-wn-open-settings" class="jct-settings-save-btn">⚙️ פתח אפשרויות</button>
					<button type="button" id="jct-wn-dismiss" class="jct-settings-reset-btn">הבנתי</button>
				</div>
			</div>
		`;

		document.body.appendChild(modal);

		const dismiss = () => {
			markVersionSeen(version);
			modal.remove();
		};

		modal.querySelector('.jct-assignments-modal-close').addEventListener('click', dismiss);
		modal.querySelector('#jct-wn-dismiss').addEventListener('click', dismiss);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) dismiss();
		});

		const tryDarkBtn = modal.querySelector('#jct-wn-toggle-dark');
		tryDarkBtn?.addEventListener('click', async () => {
			await JCT.theme.toggleDarkMode();
			const nowDark = JCT.theme.getEffectiveTheme() === 'dark';
			tryDarkBtn.textContent = nowDark ? '☀️ נסה בהיר' : '🌙 נסה עכשיו';
		});

		modal.querySelector('#jct-wn-open-settings').addEventListener('click', () => {
			dismiss();
			JCT.modals.showSettingsModal();
		});
	}

	async function checkAndShowWhatsNew() {
		// Only show on the main frontpage so we never interrupt quizzes or assignments
		if (!document.body || document.body.id !== 'page-site-index') return;

		const currentVersion = getExtensionVersion();
		const res = await JCT.storage.storageGet('local', { [SEEN_VERSION_KEY]: null });
		if (res[SEEN_VERSION_KEY] === currentVersion) return;

		showWhatsNewModal(currentVersion);
	}

	JCT.modals = JCT.modals || {};
	JCT.modals.showWhatsNewModal = showWhatsNewModal;
	JCT.modals.checkAndShowWhatsNew = checkAndShowWhatsNew;
})(window.JCT = window.JCT || {});
