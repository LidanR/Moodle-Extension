(function (JCT) {
	'use strict';

	const {
		escapeHtml,
		parseHebrewYearAndSemester,
		hebrewYearToGematria,
		getCurrentHebrewYear,
		semesterMatches,
		isExcludedCourse,
		shouldShowAssignment
	} = JCT.utils;

	function buildAvailableHebrewYears(cachedAssignments) {
		const years = new Set();

		// 1. Detect Hebrew years strictly from courses available to the user on the page
		const uniqueCourses = JCT.assignments.collectUniqueCoursesFromPage();
		for (const { courseName } of uniqueCourses.values()) {
			if (isExcludedCourse(courseName)) continue;
			const { year } = parseHebrewYearAndSemester(courseName);
			if (year) years.add(year);
		}

		// 2. Also include any years present in cached assignments (in case courses are paginated/elsewhere)
		if (Array.isArray(cachedAssignments)) {
			for (const assign of cachedAssignments) {
				const { year } = parseHebrewYearAndSemester(assign.courseName || '');
				if (year) years.add(year);
			}
		}

		// Fallback only if literally no courses with Hebrew years were detected
		if (years.size === 0) {
			years.add(getCurrentHebrewYear());
		}

		// Sort newest academic year first
		return Array.from(years).sort((a, b) => b - a);
	}

	function showScanWarning() {
		return new Promise((resolve) => {
			const warningModal = document.createElement('div');
			warningModal.className = 'jct-scan-warning-modal';
			warningModal.innerHTML = `
				<div class="jct-scan-warning-overlay"></div>
				<div class="jct-scan-warning-content">
					<div class="jct-scan-warning-icon">⏱️</div>
					<h3>אזהרה - סריקת מטלות</h3>
					<p>סריקת כל המטלות עשויה לקחת בין <strong>30 שניות ל-2 דקות</strong>.</p>
					<p style="font-size: 0.875rem; color: #64748b; margin-top: 8px;">המערכת תסרוק את כל הקורסים שנבחרו ותבדוק את סטטוס ההגשות.</p>
					<div class="jct-scan-warning-buttons">
						<button type="button" class="jct-scan-warning-cancel">ביטול</button>
						<button type="button" class="jct-scan-warning-proceed">המשך בסריקה</button>
					</div>
				</div>
			`;
			document.body.appendChild(warningModal);

			const closeWith = (val) => {
				warningModal.remove();
				resolve(val);
			};

			warningModal.querySelector('.jct-scan-warning-cancel').addEventListener('click', () => closeWith(false));
			warningModal.querySelector('.jct-scan-warning-proceed').addEventListener('click', () => closeWith(true));
			warningModal.querySelector('.jct-scan-warning-overlay').addEventListener('click', () => closeWith(false));
		});
	}

	async function showAllAssignmentsModal() {
		if (document.querySelector('.jct-assignments-modal') || JCT.state.isModalOpening) {
			return;
		}
		JCT.state.isModalOpening = true;

		let modal;
		try {
			const [{ cache: initialCache }, settings] = await Promise.all([
				JCT.storage.getAssignmentsCache(),
				JCT.storage.storageGet('sync', {
					maxOverdueDays: 0,
					assignmentFilterYear: '',
					assignmentFilterSemester: '',
					hideSubmittedAssignments: false
				})
			]);

			const maxOverdueDays = settings.maxOverdueDays !== undefined ? settings.maxOverdueDays : 0;
			const savedFilterYear = settings.assignmentFilterYear || '';
			const savedFilterSemester = settings.assignmentFilterSemester || '';
			const hideSubmitted = Boolean(settings.hideSubmittedAssignments);

			const availableYears = buildAvailableHebrewYears(initialCache?.assignments);
			const yearOptionsHtml = availableYears.map(
				(y) => `<option value="${y}" ${savedFilterYear === String(y) ? 'selected' : ''}>${hebrewYearToGematria(y)}</option>`
			).join('');

			modal = document.createElement('div');
			modal.className = 'jct-assignments-modal';
			modal.innerHTML = `
				<div class="jct-assignments-modal-content jct-assignments-modal-large">
					<div class="jct-assignments-modal-header" style="box-sizing: border-box;">
						<h3 id="jct-modal-title">טוענים קורסים...</h3>
						<div id="jct-scanning-notice" style="display: none;">
							⏳ סורקים... נא להמתין
						</div>
						<button type="button" class="jct-assignments-modal-close">✕</button>
					</div>

					<div class="jct-assign-modal-layout">
						<div class="jct-filter-controls">
							<div style="display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; flex-shrink: 0;">
								<div class="jct-filter-section-title" style="font-weight: 600; font-size: 0.9rem;">סינון תקופה</div>
								<div style="display: flex; flex-direction: column; gap: 10px; box-sizing: border-box;">
									<label style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
										<span class="jct-filter-label" style="font-weight: 500; font-size: 0.8125rem;">שנה:</span>
										<select id="jct-filter-year" style="width: 120px; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 0.8125rem; box-sizing: border-box;">
											<option value="" ${savedFilterYear === '' ? 'selected' : ''}>בחרו...</option>
											${yearOptionsHtml}
										</select>
									</label>
									<label style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
										<span class="jct-filter-label" style="font-weight: 500; font-size: 0.8125rem;">סמסטר:</span>
										<select id="jct-filter-semester" style="width: 120px; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 0.8125rem; box-sizing: border-box;">
											<option value="" ${savedFilterSemester === '' ? 'selected' : ''}>בחרו...</option>
											<option value="0" ${savedFilterSemester === '0' ? 'selected' : ''}>אלול</option>
											<option value="1" ${savedFilterSemester === '1' ? 'selected' : ''}>א'</option>
											<option value="2" ${savedFilterSemester === '2' ? 'selected' : ''}>ב'</option>
										</select>
									</label>
								</div>
							</div>

							<div class="jct-filter-divider" style="height: 1px; width: 100%; flex-shrink: 0;"></div>

							<div style="display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; flex-shrink: 0;">
								<div class="jct-filter-section-title" style="font-weight: 600; font-size: 0.9rem;">הגדרות תצוגה</div>
								<label style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
									<span class="jct-filter-label" style="font-weight: 500; font-size: 0.8125rem; line-height: 1.2;">הסתירו איחור מעל (ימים):</span>
									<input id="jct-max-overdue-days" type="number" min="0" step="1" value="${maxOverdueDays}" style="width: 60px; padding: 4px; border-radius: 4px; font-size: 0.8125rem; text-align: center; box-sizing: border-box;">
								</label>
								<label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
									<input type="checkbox" id="jct-hide-submitted" ${hideSubmitted ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;">
									<span class="jct-filter-label" style="font-weight: 500; font-size: 0.8125rem; line-height: 1.2;">הסתירו מטלות שהוגשו</span>
								</label>
							</div>

							<div class="jct-filter-divider" style="height: 1px; width: 100%; flex-shrink: 0;"></div>

							<div id="jct-course-selection-container" style="display: none; flex-direction: column; flex: 1; min-height: 100px; overflow: hidden; box-sizing: border-box;">
								<div class="jct-filter-section-title" style="font-size: 0.9rem; font-weight: 600; margin-bottom: 10px; flex-shrink: 0;">בחרו קורסים לסריקה:</div>
								<div id="jct-course-checkboxes" style="display: flex; flex-direction: column; gap: 10px; flex: 1; overflow-y: auto; padding-left: 5px; padding-bottom: 5px; box-sizing: border-box;"></div>
							</div>

							<div class="jct-filter-divider" style="height: 1px; width: 100%; margin-top: auto; flex-shrink: 0;"></div>

							<div class="jct-filter-actions" style="display: flex; flex-direction: column; gap: 10px; padding-top: 4px; box-sizing: border-box; flex-shrink: 0;">
								<button type="button" id="jct-refresh-assignments" style="padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.875rem; transition: all 0.2s; display: flex; justify-content: center; align-items: center; gap: 8px; width: 100%; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2); box-sizing: border-box;" title="בדקו סטטוס הגשות מחדש">
									<span>🔄</span> בדקו הגשות
								</button>
								<button type="button" id="jct-rescan-assignments" style="padding: 12px; background: #f59e0b; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.875rem; transition: all 0.2s; display: flex; justify-content: center; align-items: center; gap: 8px; width: 100%; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2); box-sizing: border-box;" title="סריקה מחדש - סורקים את כל המטלות מחדש">
									<span>🔍</span> סרקו מחדש
								</button>
							</div>
						</div>

						<div class="jct-assign-main-area">
							<div class="jct-modal-status" style="padding: 14px 20px; min-height: 48px; display: flex; align-items: center; box-sizing: border-box;">
								<div id="jct-loading-status" style="font-size: 0.875rem; font-weight: 500;">
									<span class="jct-loading-spinner-small"></span> מתחילים סריקה...
								</div>
							</div>
							<div class="jct-assignments-modal-body" id="jct-results-container"></div>
						</div>
					</div>
				</div>
			`;
			document.body.appendChild(modal);
		} finally {
			JCT.state.isModalOpening = false;
		}

		let isScanning = false;
		let totalCourses = 0;
		let totalAssignments = 0;

		const filterYearSelect = document.getElementById('jct-filter-year');
		const filterSemesterSelect = document.getElementById('jct-filter-semester');
		const maxOverdueDaysInput = document.getElementById('jct-max-overdue-days');
		const hideSubmittedCheckbox = document.getElementById('jct-hide-submitted');
		const refreshBtn = document.getElementById('jct-refresh-assignments');
		const rescanBtn = document.getElementById('jct-rescan-assignments');
		const closeBtn = modal.querySelector('.jct-assignments-modal-close');
		const scanningNotice = document.getElementById('jct-scanning-notice');
		const statusEl = document.getElementById('jct-loading-status');
		const resultsContainer = document.getElementById('jct-results-container');

		function setControlsDisabled(disabled) {
			if (filterYearSelect) filterYearSelect.disabled = disabled;
			if (filterSemesterSelect) filterSemesterSelect.disabled = disabled;
			if (maxOverdueDaysInput) maxOverdueDaysInput.disabled = disabled;
			if (hideSubmittedCheckbox) hideSubmittedCheckbox.disabled = disabled;
			if (refreshBtn) refreshBtn.disabled = disabled;
			if (rescanBtn) rescanBtn.disabled = disabled;
			modal.querySelectorAll('.jct-course-checkbox').forEach((cb) => {
				cb.disabled = disabled;
			});
			if (closeBtn) closeBtn.style.display = disabled ? 'none' : '';
			if (scanningNotice) scanningNotice.style.display = disabled ? 'block' : 'none';
		}

		function getExcludedCourseIdsFromUI() {
			const excluded = new Set();
			modal.querySelectorAll('.jct-course-checkbox:not(:checked)').forEach((cb) => {
				excluded.add(cb.value);
			});
			return excluded;
		}

		function closeModal() {
			if (isScanning) return;
			JCT.state.stopScanning = true;
			modal.remove();
			JCT.schedule.updateWeeklyScheduleView();
		}

		closeBtn.addEventListener('click', closeModal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) closeModal();
		});

		function onProgress(current, total, courseName) {
			if (statusEl) {
				statusEl.innerHTML = `<span class="jct-loading-spinner-small"></span> סורק קורס ${current} מתוך ${total}: ${escapeHtml(courseName)}`;
			}
		}

		function appendCourseResult(courseInfo, assignments) {
			if (!resultsContainer) return;

			totalCourses++;
			totalAssignments += assignments.length;

			const courseDiv = document.createElement('div');
			courseDiv.className = 'jct-course-assignments-group';

			let html = `
				<h4 class="jct-course-group-title">
					<a href="${escapeHtml(courseInfo.courseUrl)}" target="_blank">${escapeHtml(courseInfo.courseName)}</a>
					<span class="jct-assignment-count">(${assignments.length})</span>
				</h4>
			`;

			if (assignments.length === 0) {
				html += '<div class="jct-no-assignments">אין מטלות בקורס זה</div>';
			} else {
				html += '<div class="jct-assignments-list-modal">';

				assignments.forEach((assign) => {
					let dueDateHtml = '';
					if (assign.dueDate) {
						const now = new Date();
						const dueDate = assign.dueDate instanceof Date ? assign.dueDate : new Date(assign.dueDate);
						const isOverdue = dueDate < now;
						const isSubmitted = assign.submissionStatus === 'submitted';
						const msPerDay = 24 * 60 * 60 * 1000;
						const daysUntilDue = Math.ceil((dueDate - now) / msPerDay);

						let dateColor = '#64748b';
						let dateText = '';
						if (isSubmitted) {
							dateColor = '#16a34a';
						} else if (isOverdue) {
							const daysOverdue = Math.floor((now - dueDate) / msPerDay);
							dateColor = '#dc2626';
							dateText = `באיחור ${daysOverdue} ${daysOverdue === 1 ? 'יום' : 'ימים'}`;
						} else if (daysUntilDue <= 3) {
							dateColor = '#ea580c';
							dateText = `נשאר ${daysUntilDue} ${daysUntilDue === 1 ? 'יום' : 'ימים'}`;
						} else if (daysUntilDue <= 7) {
							dateColor = '#eab308';
							dateText = `נשאר ${daysUntilDue} ימים`;
						} else {
							dateColor = '#16a34a';
							dateText = `נשאר ${daysUntilDue} ימים`;
						}

						const formattedDate = dueDate.toLocaleDateString('he-IL', {
							day: 'numeric',
							month: 'long',
							year: 'numeric'
						});

						dueDateHtml = `
							<div class="jct-assignment-due-date" style="font-size: 0.75rem; color: ${dateColor}; margin-top: 4px; font-weight: 500;">
								📅 ${formattedDate}${dateText ? ` (${dateText})` : ''}
							</div>
						`;
					} else {
						dueDateHtml = `
							<div class="jct-assignment-due-date" style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px; font-style: italic;">
								⏰ אין תאריך סיום
							</div>
						`;
					}

					const gradeHtml = assign.grade
						? `<span style="background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-right: 4px; font-weight: 600;">ציון: ${escapeHtml(assign.grade)}</span>`
						: '';

					let statusHtml = '';
					if (assign.submissionStatus === 'submitted') {
						statusHtml = `
							<div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
								<div class="jct-assignment-status submitted" style="font-size: 0.75rem; color: #16a34a; font-weight: 600; display: flex; align-items: center; gap: 4px;">
									<span>✓</span><span>הוגש</span>
								</div>
								${gradeHtml}
							</div>
						`;
					} else if (assign.submissionStatus === 'not_submitted') {
						statusHtml = `
							<div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
								<div class="jct-assignment-status not-submitted" style="font-size: 0.75rem; color: #dc2626; font-weight: 600; display: flex; align-items: center; gap: 4px;">
									<span>✗</span><span>לא הוגש</span>
								</div>
								${gradeHtml}
							</div>
						`;
					} else if (gradeHtml) {
						statusHtml = `<div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">${gradeHtml}</div>`;
					}

					html += `
						<div class="jct-assignment-box">
							<div class="jct-assignment-box-name">${escapeHtml(assign.assignmentName)}</div>
							${dueDateHtml}
							${statusHtml}
							<a href="${escapeHtml(assign.assignmentUrl)}" class="jct-assignment-box-link" target="_blank">פתח מטלה →</a>
						</div>
					`;
				});

				html += '</div>';
			}

			courseDiv.innerHTML = html;
			resultsContainer.appendChild(courseDiv);

			const titleEl = document.getElementById('jct-modal-title');
			if (titleEl) {
				titleEl.textContent = `כל הקורסים (${totalCourses}) | מטלות (${totalAssignments})`;
			}
		}

		async function updateCourseSelectionUI() {
			const container = document.getElementById('jct-course-selection-container');
			const checkboxesDiv = document.getElementById('jct-course-checkboxes');
			const filterYear = filterYearSelect?.value;
			const filterSemester = filterSemesterSelect?.value;

			if (!container || !checkboxesDiv) return;
			if (!filterYear || !filterSemester) {
				container.style.display = 'none';
				return;
			}

			const { excludedCourseIds } = await JCT.storage.storageGet('sync', { excludedCourseIds: [] });
			const excludedSet = new Set(Array.isArray(excludedCourseIds) ? excludedCourseIds : []);
			const uniqueCoursesMap = JCT.assignments.collectUniqueCoursesFromPage();
			const targetYear = parseInt(filterYear, 10);

			const matchingCourses = [];
			for (const { courseId, courseName } of uniqueCoursesMap.values()) {
				if (isExcludedCourse(courseName)) continue;
				const { year, semIdx } = parseHebrewYearAndSemester(courseName);
				if (year === targetYear && semesterMatches(semIdx, filterSemester)) {
					const displayName = courseName.replace(/^[\d.]+\s*-\s*/, '');
					matchingCourses.push({ id: courseId, name: courseName, displayName });
				}
			}

			if (matchingCourses.length > 0) {
				container.style.display = 'flex';
				checkboxesDiv.innerHTML = matchingCourses.map((c) => `
					<label class="jct-course-checkbox-item" style="display: flex; align-items: center; gap: 4px; font-size: 0.75rem; padding: 4px 8px; border-radius: 4px; cursor: pointer;">
						<input type="checkbox" class="jct-course-checkbox" value="${escapeHtml(c.id)}" ${excludedSet.has(c.id) ? '' : 'checked'}>
						<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;" title="${escapeHtml(c.name)}">${escapeHtml(c.displayName)}</span>
					</label>
				`).join('');

				checkboxesDiv.querySelectorAll('.jct-course-checkbox').forEach((cb) => {
					cb.addEventListener('change', async () => {
						const res = await JCT.storage.storageGet('sync', { excludedCourseIds: [] });
						const currentExcluded = new Set(Array.isArray(res.excludedCourseIds) ? res.excludedCourseIds : []);
						if (cb.checked) currentExcluded.delete(cb.value);
						else currentExcluded.add(cb.value);
						await JCT.storage.storageSet('sync', { excludedCourseIds: Array.from(currentExcluded) });
					});
				});
			} else {
				container.style.display = 'none';
			}
		}

		async function refilterAndDisplayFromCache(
			cachedData,
			maxOverdueDays,
			filterYear,
			filterSemester,
			forceRefreshStatus = false,
			hideSubmitted = false
		) {
			if (forceRefreshStatus) {
				setControlsDisabled(true);
			}

			try {
				if (statusEl) {
					statusEl.innerHTML = forceRefreshStatus
						? '<span class="jct-loading-spinner-small"></span> מעדכן סטטוס הגשות...'
						: '<span class="jct-loading-spinner-small"></span> מסנן מטלות מהמטמון...';
				}

				const excludedCourseIds = getExcludedCourseIdsFromUI();
				const targetYear = parseInt(filterYear, 10);

				const yearFiltered = (cachedData.assignments || []).filter((assign) => {
					if (excludedCourseIds.has(assign.courseId)) return false;
					const { year, semIdx } = parseHebrewYearAndSemester(assign.courseName);
					return year === targetYear && semesterMatches(semIdx, filterSemester);
				});

				const assignmentsWithData = await JCT.assignments.enrichAssignments(yearFiltered, {
					forceRefreshDueDate: false,
					forceRefreshStatus,
					forceRefreshGrades: forceRefreshStatus
				});

				const filteredAssignments = assignmentsWithData.filter((assign) => {
					if (!shouldShowAssignment(assign.dueDate, maxOverdueDays)) return false;
					if (hideSubmitted && assign.submissionStatus === 'submitted') return false;
					return true;
				});

				if (resultsContainer) {
					resultsContainer.innerHTML = '';
				}
				totalCourses = 0;
				totalAssignments = 0;

				const coursesMap = new Map(cachedData.courses || []);
				for (const [courseId, courseInfo] of coursesMap) {
					if (excludedCourseIds.has(courseId)) continue;
					const courseAssignments = filteredAssignments.filter((a) => a.courseId === courseId);
					if (courseAssignments.length > 0) {
						appendCourseResult(courseInfo, courseAssignments);
					}
				}

				if (totalCourses === 0 && resultsContainer) {
					resultsContainer.innerHTML = `
						<div style="text-align: center; padding: 40px 20px; color: #64748b;">
							<div style="font-size: 2.5rem; margin-bottom: 12px;">✨</div>
							<p style="margin: 0; font-size: 1rem;">אין מטלות תואמות לסינון הנוכחי</p>
						</div>
					`;
					const titleEl = document.getElementById('jct-modal-title');
					if (titleEl) titleEl.textContent = 'כל הקורסים (0) | מטלות (0)';
				}

				if (statusEl) {
					const { timestamp } = await JCT.storage.getAssignmentsCache();
					const cacheTime = timestamp ? new Date(timestamp).toLocaleString('he-IL') : '';
					const hiddenCount = yearFiltered.length - totalAssignments;
					let statusText = `✓ מטלות עודכנו מהמטמון - ${totalCourses} קורסים, ${totalAssignments} מטלות`;
					if (hiddenCount > 0) statusText += ` (${hiddenCount} מוסתרות לפי סינון)`;
					if (cacheTime) statusText += ` | עדכון אחרון: ${cacheTime}`;
					statusEl.textContent = statusText;
				}
			} finally {
				if (forceRefreshStatus) {
					setControlsDisabled(false);
				}
			}
		}

		async function loadAndDisplayAssignments(forceRefresh = false, savedYear = '', savedSemester = '') {
			const filterYear = filterYearSelect?.value || '';
			const filterSemester = filterSemesterSelect?.value || '';
			const maxOverdueDays = parseInt(maxOverdueDaysInput?.value || '0', 10) || 0;
			const hideSubmitted = Boolean(hideSubmittedCheckbox?.checked);

			if (!filterYear || !filterSemester) {
				if (statusEl) statusEl.textContent = 'ממתינים לבחירת סמסטר...';
				if (resultsContainer) {
					resultsContainer.innerHTML = `
						<div style="text-align: center; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
							<div style="font-size: 3rem; margin-bottom: 16px;">📅</div>
							<h3 style="font-size: 1.25rem; color: #ef4444; margin-bottom: 12px; margin-top: 0;">יש לבחור שנה וסמסטר לפני הסריקה</h3>
							<p style="font-size: 1rem; color: #64748b; margin-top: 0;">בחרו שנה וסמסטר מהתפריט ולחצו על "סרקו מחדש"</p>
						</div>
					`;
				}
				return false;
			}

			const { cache, timestamp } = await JCT.storage.getAssignmentsCache();
			const hasCache = Boolean(cache && Array.isArray(cache.assignments) && cache.assignments.length > 0);
			const cacheValid = hasCache && JCT.storage.isCacheValid(timestamp);
			const yearSemesterChanged = Boolean(
				savedYear && savedSemester && (savedYear !== filterYear || savedSemester !== filterSemester)
			);

			if (!forceRefresh && cacheValid && !yearSemesterChanged) {
				await refilterAndDisplayFromCache(cache, maxOverdueDays, filterYear, filterSemester, false, hideSubmitted);
				return true;
			}

			// Ask confirmation BEFORE clearing any caches!
			const shouldProceed = await showScanWarning();
			if (!shouldProceed) return false;

			if (forceRefresh) {
				await JCT.storage.clearAllAssignmentCaches();
			}

			isScanning = true;
			setControlsDisabled(true);

			try {
				if (resultsContainer) {
					resultsContainer.innerHTML = '';
					totalCourses = 0;
					totalAssignments = 0;
				}

				if (statusEl) {
					statusEl.innerHTML = forceRefresh
						? '<span class="jct-loading-spinner-small"></span> מרענן נתונים...'
						: '<span class="jct-loading-spinner-small"></span> טוען נתונים...';
				}

				JCT.state.stopScanning = false;
				const excludedCourseIds = getExcludedCourseIdsFromUI();

				const result = await JCT.assignments.scanAllCoursesForAssignments(
					true,
					filterYear,
					filterSemester,
					excludedCourseIds,
					{ onProgress, onCourseResult: appendCourseResult }
				);

				if (result) {
					if (statusEl) {
						statusEl.innerHTML = '<span class="jct-loading-spinner-small"></span> בודק תאריכי סיום, סטטוס הגשות וציונים...';
					}

					const assignmentsWithData = await JCT.assignments.enrichAssignments(result.assignments, {
						forceRefreshDueDate: false,
						forceRefreshStatus: true,
						forceRefreshGrades: true
					});

					const filteredAssignments = assignmentsWithData.filter((assign) => {
						if (!shouldShowAssignment(assign.dueDate, maxOverdueDays)) return false;
						if (hideSubmitted && assign.submissionStatus === 'submitted') return false;
						return true;
					});

					if (resultsContainer) resultsContainer.innerHTML = '';
					totalCourses = 0;
					totalAssignments = 0;

					for (const [courseId, courseInfo] of result.courses) {
						const courseAssignments = filteredAssignments.filter((a) => a.courseId === courseId);
						appendCourseResult(courseInfo, courseAssignments);
					}
				}

				if (statusEl) {
					const { timestamp: newTs } = await JCT.storage.getAssignmentsCache();
					const cacheTime = newTs ? new Date(newTs).toLocaleString('he-IL') : '';
					const totalBeforeFilter = result ? result.assignments.length : 0;
					const hiddenCount = totalBeforeFilter - totalAssignments;
					let statusText = `✓ סריקה הושלמה - ${totalCourses} קורסים, ${totalAssignments} מטלות`;
					if (hiddenCount > 0) statusText += ` (${hiddenCount} מוסתרות לפי סינון)`;
					if (cacheTime) statusText += ` | עדכון אחרון: ${cacheTime}`;
					statusEl.textContent = statusText;
				}

				await JCT.storage.storageSet('sync', {
					assignmentFilterYear: filterYear,
					assignmentFilterSemester: filterSemester
				});

				return true;
			} catch (err) {
				console.error('[JCT] Error during full scan:', err);
				if (statusEl) {
					statusEl.innerHTML = '<span style="color: #dc2626;">❌ אירעה שגיאה בזמן הסריקה. נסה שוב.</span>';
				}
				return false;
			} finally {
				isScanning = false;
				setControlsDisabled(false);
			}
		}

		// ---- Event Listeners ----

		await updateCourseSelectionUI();

		filterYearSelect?.addEventListener('change', () => updateCourseSelectionUI());
		filterSemesterSelect?.addEventListener('change', () => updateCourseSelectionUI());

		maxOverdueDaysInput?.addEventListener('change', async () => {
			const newValue = Math.max(0, parseInt(maxOverdueDaysInput.value || '0', 10) || 0);
			await JCT.storage.storageSet('sync', { maxOverdueDays: newValue });

			const { cache, timestamp } = await JCT.storage.getAssignmentsCache();
			if (cache && JCT.storage.isCacheValid(timestamp)) {
				await refilterAndDisplayFromCache(
					cache,
					newValue,
					filterYearSelect?.value || '',
					filterSemesterSelect?.value || '',
					false,
					Boolean(hideSubmittedCheckbox?.checked)
				);
			}
		});

		hideSubmittedCheckbox?.addEventListener('change', async () => {
			const isChecked = hideSubmittedCheckbox.checked;
			await JCT.storage.storageSet('sync', { hideSubmittedAssignments: isChecked });

			const { cache, timestamp } = await JCT.storage.getAssignmentsCache();
			if (cache && JCT.storage.isCacheValid(timestamp)) {
				await refilterAndDisplayFromCache(
					cache,
					parseInt(maxOverdueDaysInput?.value || '0', 10) || 0,
					filterYearSelect?.value || '',
					filterSemesterSelect?.value || '',
					false,
					isChecked
				);
			}
		});

		// "Check submissions" — refreshes statuses & grades without rescanning courses
		refreshBtn?.addEventListener('click', async () => {
			const { cache } = await JCT.storage.getAssignmentsCache();
			if (!cache || !Array.isArray(cache.assignments) || cache.assignments.length === 0) {
				if (statusEl) {
					statusEl.innerHTML = '<span style="color: #f59e0b;">⚠️ אין נתונים במטמון. יש ללחוץ על "סרקו מחדש" קודם.</span>';
				}
				return;
			}

			isScanning = true;
			refreshBtn.innerHTML = '⏳ בודק...';
			try {
				await JCT.storage.storageSet('local', { submissionStatusCache: {} });
				await refilterAndDisplayFromCache(
					cache,
					parseInt(maxOverdueDaysInput?.value || '0', 10) || 0,
					filterYearSelect?.value || '',
					filterSemesterSelect?.value || '',
					true,
					Boolean(hideSubmittedCheckbox?.checked)
				);
			} finally {
				isScanning = false;
				refreshBtn.innerHTML = '<span>🔄</span> בדקו הגשות';
			}
		});

		// "Rescan" — asks warning first, then clears caches & rescans all selected courses
		rescanBtn?.addEventListener('click', async () => {
			rescanBtn.innerHTML = '⏳ סורקים...';
			try {
				const currentSettings = await JCT.storage.storageGet('sync', {
					assignmentFilterYear: '',
					assignmentFilterSemester: ''
				});
				await loadAndDisplayAssignments(
					true,
					currentSettings.assignmentFilterYear || '',
					currentSettings.assignmentFilterSemester || ''
				);
			} finally {
				rescanBtn.innerHTML = '<span>🔍</span> סרקו מחדש';
			}
		});

		// Initial view
		const { cache, timestamp } = await JCT.storage.getAssignmentsCache();
		if (cache && JCT.storage.isCacheValid(timestamp)) {
			await loadAndDisplayAssignments(false);
		} else {
			if (statusEl) statusEl.textContent = 'ממתינים לבחירת סמסטר...';
			if (resultsContainer) {
				resultsContainer.innerHTML = `
					<div style="text-align: center; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
						<div style="font-size: 3rem; margin-bottom: 16px;">👋</div>
						<h3 style="font-size: 1.25rem; color: #1e293b; margin-bottom: 12px; margin-top: 0;">מוכנים לסרוק את המטלות שלכם?</h3>
						<p style="font-size: 1rem; color: #64748b; margin-top: 0;">בחרו שנה וסמסטר ולחצו על "סרקו מחדש" כדי לסרוק מטלות</p>
					</div>
				`;
			}
		}
	}

	JCT.modals = JCT.modals || {};
	JCT.modals.showAllAssignmentsModal = showAllAssignmentsModal;
})(window.JCT = window.JCT || {});

