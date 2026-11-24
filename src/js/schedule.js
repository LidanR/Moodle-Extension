(function (JCT) {
	'use strict';

	const {
		DAYS_OF_WEEK,
		DAYS_OF_WEEK_EN,
		TODO_ICONS,
		TODO_COLORS,
		TODO_PRIORITIES
	} = JCT.config;
	const { escapeHtml, getCourseNameFromCard, getCourseUrlFromCard, parseLocalDate } = JCT.utils;

	const PRIORITY_META = TODO_PRIORITIES.reduce((acc, p) => {
		acc[p.id] = p;
		return acc;
	}, {});

	// ---- Schedule Day Picker Modal ----

	function showScheduleDayPicker(courseId, card) {
		const courseName = getCourseNameFromCard(card);
		const courseUrl = getCourseUrlFromCard(card);
		const existing = JCT.state.courseSchedules[courseId];

		const draftSessions = existing && Array.isArray(existing.sessions)
			? existing.sessions.map(s => ({ ...s }))
			: [];

		const modal = document.createElement('div');
		modal.className = 'jct-schedule-modal';

		function renderSessionsHtml() {
			const sessionsHtml = draftSessions.map((session, idx) => `
				<div class="jct-session-item" data-session-idx="${idx}">
					<select class="jct-session-day">
						${DAYS_OF_WEEK.map((day, i) => {
							const selected = DAYS_OF_WEEK_EN[i] === session.day ? 'selected' : '';
							return `<option value="${DAYS_OF_WEEK_EN[i]}" ${selected}>${day}</option>`;
						}).join('')}
					</select>
					<input type="time" class="jct-session-time" value="${escapeHtml(session.startTime || '')}" placeholder="התחלה">
					<span>-</span>
					<input type="time" class="jct-session-time" value="${escapeHtml(session.endTime || '')}" placeholder="סיום">
					<button type="button" class="jct-remove-session" data-idx="${idx}" title="הסר מופע">🗑️</button>
				</div>
			`).join('');

			return `
				<div class="jct-schedule-modal-content">
					<div class="jct-schedule-modal-header">
						<h3>מערכת שעות עבור: ${escapeHtml(courseName)}</h3>
						<button type="button" class="jct-schedule-modal-close">✕</button>
					</div>
					<div class="jct-schedule-modal-body">
						<div class="jct-sessions-container">
							${sessionsHtml}
						</div>
						<button type="button" class="jct-add-session">+ הוסף מופע</button>
					</div>
					<div class="jct-schedule-modal-footer">
						<button type="button" class="jct-schedule-modal-save">שמור</button>
						<button type="button" class="jct-schedule-modal-remove">הסר מלוח זמנים</button>
					</div>
				</div>
			`;
		}

		function renderAndBind() {
			modal.innerHTML = renderSessionsHtml();

			modal.querySelector('.jct-schedule-modal-close')?.addEventListener('click', () => modal.remove());

			modal.querySelector('.jct-add-session')?.addEventListener('click', () => {
				draftSessions.push({ day: 'sunday', startTime: '', endTime: '' });
				renderAndBind();
			});

			modal.querySelectorAll('.jct-remove-session').forEach((btn) => {
				btn.addEventListener('click', () => {
					const idx = parseInt(btn.getAttribute('data-idx'), 10);
					draftSessions.splice(idx, 1);
					renderAndBind();
				});
			});

			modal.querySelectorAll('.jct-session-item').forEach((item, idx) => {
				const daySelect = item.querySelector('.jct-session-day');
				const timeInputs = item.querySelectorAll('input.jct-session-time');

				daySelect.addEventListener('change', () => {
					draftSessions[idx].day = daySelect.value;
				});
				timeInputs[0].addEventListener('change', () => {
					draftSessions[idx].startTime = timeInputs[0].value;
				});
				timeInputs[1].addEventListener('change', () => {
					draftSessions[idx].endTime = timeInputs[1].value;
				});
			});

			modal.querySelector('.jct-schedule-modal-save')?.addEventListener('click', async () => {
				if (draftSessions.length > 0) {
					JCT.state.courseSchedules[courseId] = {
						name: courseName,
						sessions: draftSessions.map(s => ({ ...s })),
						url: courseUrl
					};
				} else {
					delete JCT.state.courseSchedules[courseId];
				}

				try {
					await JCT.storage.saveCourseSchedules();
					await updateWeeklyScheduleView();
					modal.remove();
				} catch (err) {
					console.error('[JCT Schedule] Error saving schedule:', err);
					alert('שגיאה בשמירת הלוח זמנים. נסה שוב.');
					modal.remove();
				}
			});

			modal.querySelector('.jct-schedule-modal-remove')?.addEventListener('click', async () => {
				delete JCT.state.courseSchedules[courseId];
				try {
					await JCT.storage.saveCourseSchedules();
					await updateWeeklyScheduleView();
				} catch (err) {
					console.error('[JCT Schedule] Error removing course:', err);
				} finally {
					modal.remove();
				}
			});
		}

		document.body.appendChild(modal);
		renderAndBind();

		modal.addEventListener('click', (e) => {
			if (e.target === modal) modal.remove();
		});
	}

	// ---- Time Picker Dialog (on Drag & Drop) ----

	function showTimePickerDialog(courseName) {
		return new Promise((resolve) => {
			const dialog = document.createElement('div');
			dialog.className = 'jct-time-picker-dialog';
			dialog.innerHTML = `
				<div class="jct-time-picker-content">
					<div class="jct-time-picker-header">
						<h3>בחר שעות עבור: ${escapeHtml(courseName)}</h3>
						<button type="button" class="jct-time-picker-close">✕</button>
					</div>
					<div class="jct-time-picker-body">
						<label>
							<span>שעת התחלה:</span>
							<input type="time" class="jct-time-start">
						</label>
						<label>
							<span>שעת סיום:</span>
							<input type="time" class="jct-time-end">
						</label>
					</div>
					<div class="jct-time-picker-footer">
						<button type="button" class="jct-time-picker-save">שמור</button>
						<button type="button" class="jct-time-picker-skip">דלג (ללא שעות)</button>
					</div>
				</div>
			`;

			document.body.appendChild(dialog);

			dialog.querySelector('.jct-time-picker-close').addEventListener('click', () => {
				dialog.remove();
				resolve(null);
			});
			dialog.querySelector('.jct-time-picker-skip').addEventListener('click', () => {
				dialog.remove();
				resolve({ startTime: '', endTime: '' });
			});
			dialog.querySelector('.jct-time-picker-save').addEventListener('click', () => {
				const startTime = dialog.querySelector('.jct-time-start').value;
				const endTime = dialog.querySelector('.jct-time-end').value;
				dialog.remove();
				resolve({ startTime, endTime });
			});
			dialog.addEventListener('click', (e) => {
				if (e.target === dialog) {
					dialog.remove();
					resolve(null);
				}
			});
		});
	}

	// ---- Weekly Schedule View ----

	async function createWeeklyScheduleView() {
		const body = document.body;
		if (!body || body.id !== 'page-site-index') return null;

		let scheduleContainer = document.getElementById('jct-weekly-schedule');
		if (scheduleContainer) {
			await updateWeeklyScheduleView();
			return scheduleContainer;
		}

		const region = document.getElementById('region-main') || document.querySelector('#region-main, main');
		if (!region) return null;

		scheduleContainer = document.createElement('div');
		scheduleContainer.id = 'jct-weekly-schedule';
		scheduleContainer.className = 'jct-weekly-schedule';

		const pageHeader = document.querySelector('#page-header, .page-header');
		if (pageHeader && pageHeader.parentElement) {
			pageHeader.parentElement.insertBefore(scheduleContainer, pageHeader.nextSibling);
		} else {
			const coursesHeading = region.querySelector('#frontpage-course-list h2');
			if (coursesHeading && coursesHeading.parentElement) {
				coursesHeading.parentElement.insertBefore(scheduleContainer, coursesHeading);
			} else {
				region.insertBefore(scheduleContainer, region.firstChild);
			}
		}

		scheduleContainer.addEventListener('click', async (e) => {
			const editBtn = e.target.closest('.jct-schedule-edit-course');
			if (editBtn) {
				e.preventDefault();
				e.stopPropagation();
				const courseId = editBtn.getAttribute('data-course-id');
				if (!courseId) return;

				let courseCard = document.querySelector(`.jct-course-card[data-course-id="${CSS.escape(courseId)}"]`);
				if (!courseCard) {
					const schedule = JCT.state.courseSchedules[courseId];
					if (schedule) {
						courseCard = document.createElement('div');
						courseCard.setAttribute('data-course-id', courseId);
						const link = document.createElement('a');
						link.href = schedule.url || '#';
						link.textContent = schedule.name || `קורס ${courseId}`;
						courseCard.appendChild(link);
					}
				}
				if (courseCard) {
					showScheduleDayPicker(courseId, courseCard);
				}
				return;
			}

			const deleteAllBtn = e.target.closest('.jct-schedule-delete-all-btn');
			if (deleteAllBtn) {
				e.preventDefault();
				e.stopPropagation();
				if (Object.keys(JCT.state.courseSchedules).length === 0) {
					alert('אין קורסים במערכת למחיקה');
					return;
				}
				if (
					confirm('⚠️ האם אתה בטוח שברצונך למחוק את כל הקורסים מהלוח זמנים?\n\nפעולה זו לא ניתנת לביטול!') &&
					confirm('האם אתה בטוח לחלוטין? כל הקורסים יימחקו מהלוח זמנים.')
				) {
					JCT.state.courseSchedules = {};
					try {
						await JCT.storage.saveCourseSchedules();
						await updateWeeklyScheduleView();
						alert('כל הקורסים נמחקו מהלוח זמנים');
					} catch (err) {
						console.error('[JCT Schedule] Error deleting all courses:', err);
						alert('שגיאה במחיקת הקורסים. נסה שוב.');
					}
				}
			}
		});

		await updateWeeklyScheduleView();
		return scheduleContainer;
	}

	async function updateWeeklyScheduleView() {
		const scheduleContainer = document.getElementById('jct-weekly-schedule');
		if (!scheduleContainer) return;

		const hideSchedule = Boolean(JCT.state.hideWeeklySchedule);
		const hideTodo = Boolean(JCT.state.hideTodo);

		scheduleContainer.classList.toggle('jct-weekly-schedule-bar-only', hideSchedule && hideTodo);

		// Both hidden: keep a sleek action bar so Settings / Calendar / Assignments stay accessible
		if (hideSchedule && hideTodo) {
			scheduleContainer.innerHTML = `
				<div class="jct-schedule-header jct-schedule-header-bar-only">
					<div class="jct-schedule-actions" id="jct-schedule-actions"></div>
				</div>
			`;
			if (JCT.main?.addActionButtons) {
				JCT.main.addActionButtons();
			}
			scheduleContainer.style.display = 'block';
			return;
		}

		// Schedule hidden, TODO visible: compact actions header + full-width TODO widget
		if (hideSchedule && !hideTodo) {
			scheduleContainer.innerHTML = `
				<div class="jct-schedule-header">
					<div class="jct-schedule-actions" id="jct-schedule-actions"></div>
				</div>
				<div class="jct-schedule-grid jct-schedule-only-todo">
					<div class="jct-schedule-day jct-todo-column">
						<div class="jct-schedule-day-header jct-todo-header">
							<span>✓ TODO</span>
							<button type="button" id="jct-todo-add-btn" class="jct-todo-open-menu-btn" title="הוסף משימה חדשה">+</button>
						</div>
						<div class="jct-todo-body">
							<div id="jct-todo-list"></div>
						</div>
					</div>
				</div>
			`;
			if (JCT.main?.addActionButtons) {
				JCT.main.addActionButtons();
			}
			await initializeTodoList();
			scheduleContainer.style.display = 'block';
			return;
		}

		const sessionsByDay = {};
		const assignmentsByDay = {};
		const eventsByDay = {};
		DAYS_OF_WEEK_EN.forEach((day) => {
			sessionsByDay[day] = [];
			assignmentsByDay[day] = [];
			eventsByDay[day] = [];
		});

		Object.entries(JCT.state.courseSchedules).forEach(([courseId, schedule]) => {
			if (!schedule || !Array.isArray(schedule.sessions) || schedule.sessions.length === 0) return;
			schedule.sessions.forEach((session) => {
				if (sessionsByDay[session.day]) {
					sessionsByDay[session.day].push({
						id: courseId,
						name: schedule.name || `קורס ${courseId}`,
						url: schedule.url || '#',
						startTime: session.startTime || '',
						endTime: session.endTime || ''
					});
				}
			});
		});

		Object.keys(sessionsByDay).forEach((day) => {
			sessionsByDay[day].sort((a, b) => {
				if (!a.startTime) return 1;
				if (!b.startTime) return -1;
				return a.startTime.localeCompare(b.startTime);
			});
		});

		const realToday = new Date();
		const targetDate = new Date(realToday);
		targetDate.setDate(targetDate.getDate() + JCT.state.currentWeekOffset * 7);
		const weekStart = new Date(targetDate);
		weekStart.setDate(targetDate.getDate() - targetDate.getDay());
		weekStart.setHours(0, 0, 0, 0);
		const weekEnd = new Date(weekStart);
		weekEnd.setDate(weekStart.getDate() + 6);
		weekEnd.setHours(23, 59, 59, 999);

		try {
			const [{ cache }, dueDateCache, submissionStatusCache, customEvents] = await Promise.all([
				JCT.storage.getAssignmentsCache(),
				JCT.storage.getDueDateCache(),
				JCT.storage.getSubmissionStatusCache(),
				JCT.storage.getCustomEvents()
			]);

			if (cache && Array.isArray(cache.assignments)) {
				cache.assignments.forEach((assignment) => {
					const ts = dueDateCache[assignment.assignmentId];
					if (!ts) return;
					const dueDate = new Date(ts);
					if (isNaN(dueDate.getTime())) return;
					if (dueDate >= weekStart && dueDate <= weekEnd) {
						const dayKey = DAYS_OF_WEEK_EN[dueDate.getDay()];
						const statusEntry = submissionStatusCache[`submission_status_${assignment.assignmentId}`];
						assignmentsByDay[dayKey].push({
							name: assignment.assignmentName,
							course: assignment.courseName,
							url: assignment.assignmentUrl,
							status: statusEntry ? statusEntry.status : 'unknown'
						});
					}
				});
			}

			customEvents.forEach((event) => {
				const eventDate = parseLocalDate(event.startDate || event.date);
				if (!eventDate) return;
				eventDate.setHours(0, 0, 0, 0);
				if (eventDate >= weekStart && eventDate <= weekEnd) {
					const dayKey = DAYS_OF_WEEK_EN[eventDate.getDay()];
					eventsByDay[dayKey].push({
						title: event.title,
						description: event.description || '',
						color: event.color || '#22c55e'
					});
				}
			});
		} catch (err) {
			console.error('[JCT Schedule] Error loading assignments/events:', err);
		}

		const weekStartLabel = `${weekStart.getDate()}/${weekStart.getMonth() + 1}`;
		const weekEndLabel = `${weekEnd.getDate()}/${weekEnd.getMonth() + 1}`;
		const todayBtnStyle = JCT.state.currentWeekOffset === 0 ? ' style="visibility:hidden"' : '';

		let html = '<div class="jct-schedule-header">';
		html += '<div class="jct-schedule-actions" id="jct-schedule-actions"></div>';
		html += '<div class="jct-week-nav">';
		html += '<button type="button" class="jct-week-nav-btn" id="jct-week-prev" title="שבוע קודם">▶</button>';
		html += `<span class="jct-week-nav-label">${weekStartLabel} - ${weekEndLabel}</span>`;
		html += '<button type="button" class="jct-week-nav-btn" id="jct-week-next" title="שבוע הבא">◀</button>';
		html += `<button type="button" class="jct-week-nav-btn jct-week-today-btn" id="jct-week-today"${todayBtnStyle}>היום</button>`;
		html += '</div>';
		html += '<div class="jct-schedule-header-right">';
		html += '<span class="jct-schedule-hint">גררו את ה 📅 מהקורס למערכת או לחצו עליו</span>';
		html += '<button type="button" class="jct-schedule-delete-all-btn" title="מחק את כל הקורסים מהלוח זמנים">🗑️ מחק הכל</button>';
		html += '</div></div>';
		html += `<div class="jct-schedule-grid${hideTodo ? ' jct-schedule-no-todo' : ''}">`;

		DAYS_OF_WEEK.forEach((dayName, idx) => {
			const dayKey = DAYS_OF_WEEK_EN[idx];
			const sessions = sessionsByDay[dayKey];
			const dayAssignments = assignmentsByDay[dayKey];
			const dayEvents = eventsByDay[dayKey];
			const isToday = JCT.state.currentWeekOffset === 0 && idx === realToday.getDay();
			const dayDate = new Date(weekStart);
			dayDate.setDate(weekStart.getDate() + idx);
			const dateStr = `${dayDate.getDate()}/${dayDate.getMonth() + 1}`;

			html += `<div class="jct-schedule-day${isToday ? ' jct-schedule-today' : ''}" data-day="${dayKey}">
				<div class="jct-schedule-day-header">${dayName}<span class="jct-day-date">${dateStr}</span></div>
				<div class="jct-schedule-day-courses" data-day="${dayKey}">`;

			if (sessions.length === 0 && dayAssignments.length === 0 && dayEvents.length === 0) {
				html += '<div class="jct-schedule-empty">-</div>';
			} else {
				sessions.forEach((s) => {
					let timeDisplay = '';
					if (s.startTime && s.endTime) {
						timeDisplay = `<div class="jct-session-time">${escapeHtml(s.startTime)} - ${escapeHtml(s.endTime)}</div>`;
					} else if (s.startTime) {
						timeDisplay = `<div class="jct-session-time">${escapeHtml(s.startTime)}</div>`;
					}
					html += `<div class="jct-schedule-course-item" data-course-id="${escapeHtml(s.id)}">
						<div class="jct-session-content">
							<a href="${escapeHtml(s.url)}" class="jct-schedule-course-link">${escapeHtml(s.name)}</a>
							${timeDisplay}
						</div>
						<button type="button" class="jct-schedule-edit-course" data-course-id="${escapeHtml(s.id)}" title="ערוך מערכת">✏️</button>
					</div>`;
				});

				if ((dayAssignments.length > 0 || dayEvents.length > 0) && sessions.length > 0) {
					html += '<div class="jct-schedule-separator"></div>';
				}

				dayAssignments.forEach((a) => {
					const isSubmitted = a.status === 'submitted';
					const statusIcon = isSubmitted ? '✓' : '✗';
					const statusClass = isSubmitted ? 'submitted' : 'not-submitted';
					html += `<a href="${escapeHtml(a.url)}" class="jct-schedule-assignment-item ${statusClass}" target="_blank" title="${escapeHtml(a.course)} - ${escapeHtml(a.name)}">
						<span class="jct-assignment-status">${statusIcon}</span>
						<span class="jct-assignment-name">${escapeHtml(a.name)}</span>
					</a>`;
				});

				dayEvents.forEach((ev) => {
					html += `<div class="jct-schedule-event-item" title="${escapeHtml(ev.description || ev.title)}">
						<span class="jct-event-dot" style="background:${escapeHtml(ev.color)}"></span>
						<span class="jct-event-name">${escapeHtml(ev.title)}</span>
					</div>`;
				});
			}

			html += '</div></div>';
		});

		// TODO column (8th column) — rendered only when TODO is not hidden
		if (!hideTodo) {
			html += `<div class="jct-schedule-day jct-todo-column">
				<div class="jct-schedule-day-header jct-todo-header">
					<span>✓ TODO</span>
					<button type="button" id="jct-todo-add-btn" class="jct-todo-open-menu-btn" title="הוסף משימה חדשה">+</button>
				</div>
				<div class="jct-todo-body">
					<div id="jct-todo-list"></div>
				</div>
			</div>`;
		}

		html += '</div>';
		scheduleContainer.innerHTML = html;

		document.getElementById('jct-week-prev')?.addEventListener('click', () => {
			JCT.state.currentWeekOffset--;
			updateWeeklyScheduleView();
		});
		document.getElementById('jct-week-next')?.addEventListener('click', () => {
			JCT.state.currentWeekOffset++;
			updateWeeklyScheduleView();
		});
		document.getElementById('jct-week-today')?.addEventListener('click', () => {
			JCT.state.currentWeekOffset = 0;
			updateWeeklyScheduleView();
		});

		if (JCT.main?.addActionButtons) {
			JCT.main.addActionButtons();
		}

		setupScheduleDropZones();
		if (!hideTodo) {
			await initializeTodoList();
		}

		scheduleContainer.style.display = 'block';
	}

	function setupScheduleDropZones() {
		const dayColumns = document.querySelectorAll('.jct-schedule-day-courses');
		dayColumns.forEach((column) => {
			column.addEventListener('dragenter', (e) => {
				e.preventDefault();
				column.classList.add('jct-schedule-drag-over');
			});

			column.addEventListener('dragover', (e) => {
				e.preventDefault();
				e.dataTransfer.dropEffect = 'copy';
			});

			column.addEventListener('dragleave', (e) => {
				if (!column.contains(e.relatedTarget)) {
					column.classList.remove('jct-schedule-drag-over');
				}
			});

			column.addEventListener('drop', async (e) => {
				e.preventDefault();
				e.stopPropagation();
				column.classList.remove('jct-schedule-drag-over');

				try {
					const dataStr = e.dataTransfer.getData('text/plain');
					if (!dataStr || dataStr === 'null') return;

					const data = JSON.parse(dataStr);
					const dayKey = column.getAttribute('data-day');
					if (!data.courseId || !dayKey) return;

					const timeData = await showTimePickerDialog(data.courseName || `קורס ${data.courseId}`);
					if (timeData === null) return;

					if (!JCT.state.courseSchedules[data.courseId]) {
						JCT.state.courseSchedules[data.courseId] = {
							name: data.courseName || `קורס ${data.courseId}`,
							sessions: [],
							url: data.courseUrl || '#'
						};
					}

					JCT.state.courseSchedules[data.courseId].sessions.push({
						day: dayKey,
						startTime: timeData.startTime || '',
						endTime: timeData.endTime || ''
					});

					await JCT.storage.saveCourseSchedules();
					await updateWeeklyScheduleView();
				} catch (err) {
					console.error('[JCT Schedule] Error handling drop:', err);
				}
			});
		});
	}

	// ---- Rich TODO Modal (Icon, Color, Priority) ----

	function openTodoDialog(existingTodo = null) {
		return new Promise((resolve) => {
			const isEdit = Boolean(existingTodo);
			let selectedIcon = existingTodo?.icon || TODO_ICONS[0];
			let selectedColor = existingTodo?.color || TODO_COLORS[0].hex;
			let selectedPriority = existingTodo?.priority || 'medium';

			const modal = document.createElement('div');
			modal.className = 'jct-todo-modal';
			modal.innerHTML = `
				<div class="jct-todo-modal-card">
					<div class="jct-todo-modal-header">
						<h4>${isEdit ? '✏️ עריכת משימה' : '➕ משימה חדשה'}</h4>
						<button type="button" class="jct-todo-modal-close">✕</button>
					</div>

					<div class="jct-todo-modal-body">
						<div class="jct-todo-field">
							<label for="jct-todo-modal-text">תיאור המשימה</label>
							<input type="text" id="jct-todo-modal-text" placeholder="לדוגמה: להגיש תרגיל בית 3..." value="${escapeHtml(existingTodo?.text || '')}" autocomplete="off">
						</div>

						<div class="jct-todo-field">
							<label>אייקון</label>
							<div class="jct-todo-icon-picker">
								${TODO_ICONS.map((icon) => `
									<button type="button" class="jct-todo-icon-opt${icon === selectedIcon ? ' active' : ''}" data-icon="${icon}">${icon}</button>
								`).join('')}
							</div>
						</div>

						<div class="jct-todo-field">
							<label>צבע</label>
							<div class="jct-todo-color-picker">
								${TODO_COLORS.map((c) => `
									<button type="button" class="jct-todo-color-opt${c.hex === selectedColor ? ' active' : ''}" data-color="${c.hex}" title="${c.name}" style="background:${c.hex};"></button>
								`).join('')}
							</div>
						</div>

						<div class="jct-todo-field">
							<label>עדיפות</label>
							<div class="jct-todo-priority-picker">
								${TODO_PRIORITIES.map((p) => `
									<button type="button" class="jct-todo-priority-opt${p.id === selectedPriority ? ' active' : ''}" data-priority="${p.id}" style="--prio-color:${p.color};">
										<span class="jct-prio-dot" style="background:${p.color};"></span>
										<span>${p.label}</span>
									</button>
								`).join('')}
							</div>
						</div>
					</div>

					<div class="jct-todo-modal-footer">
						<button type="button" class="jct-todo-modal-save">${isEdit ? 'שמור שינויים' : 'הוסף משימה'}</button>
						<button type="button" class="jct-todo-modal-cancel">ביטול</button>
					</div>
				</div>
			`;

			document.body.appendChild(modal);

			const textInput = modal.querySelector('#jct-todo-modal-text');
			setTimeout(() => textInput?.focus(), 20);

			const closeWith = (val) => {
				document.removeEventListener('keydown', onKeyDown);
				modal.remove();
				resolve(val);
			};

			const submit = () => {
				const text = textInput.value.trim();
				if (!text) {
					textInput.focus();
					textInput.classList.add('jct-input-error');
					setTimeout(() => textInput.classList.remove('jct-input-error'), 600);
					return;
				}
				closeWith({
					text,
					icon: selectedIcon,
					color: selectedColor,
					priority: selectedPriority
				});
			};

			const onKeyDown = (e) => {
				if (e.key === 'Escape') closeWith(null);
			};
			document.addEventListener('keydown', onKeyDown);

			textInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					submit();
				}
			});

			modal.querySelectorAll('.jct-todo-icon-opt').forEach((btn) => {
				btn.addEventListener('click', () => {
					selectedIcon = btn.dataset.icon;
					modal.querySelectorAll('.jct-todo-icon-opt').forEach(b => b.classList.remove('active'));
					btn.classList.add('active');
				});
			});

			modal.querySelectorAll('.jct-todo-color-opt').forEach((btn) => {
				btn.addEventListener('click', () => {
					selectedColor = btn.dataset.color;
					modal.querySelectorAll('.jct-todo-color-opt').forEach(b => b.classList.remove('active'));
					btn.classList.add('active');
				});
			});

			modal.querySelectorAll('.jct-todo-priority-opt').forEach((btn) => {
				btn.addEventListener('click', () => {
					selectedPriority = btn.dataset.priority;
					modal.querySelectorAll('.jct-todo-priority-opt').forEach(b => b.classList.remove('active'));
					btn.classList.add('active');
				});
			});

			modal.querySelector('.jct-todo-modal-save').addEventListener('click', submit);
			modal.querySelector('.jct-todo-modal-cancel').addEventListener('click', () => closeWith(null));
			modal.querySelector('.jct-todo-modal-close').addEventListener('click', () => closeWith(null));
			modal.addEventListener('click', (e) => {
				if (e.target === modal) closeWith(null);
			});
		});
	}

	// ---- TODO List ----

	async function initializeTodoList() {
		const todoAddBtn = document.getElementById('jct-todo-add-btn');
		const todoList = document.getElementById('jct-todo-list');
		if (!todoAddBtn || !todoList) return;

		let todos = await JCT.storage.getTodos();

		function renderTodos() {
			if (todos.length === 0) {
				todoList.innerHTML = `
					<div class="jct-todo-empty">
						<div class="jct-todo-empty-icon">📝</div>
						<p>אין משימות עדיין</p>
						<button type="button" class="jct-todo-empty-add">+ הוסף משימה ראשונה</button>
					</div>
				`;
				todoList.querySelector('.jct-todo-empty-add')?.addEventListener('click', handleAddTodo);
				return;
			}

			// Keep original index so check/edit/delete operate on the exact item, while sorting active tasks by priority
			const indexed = todos.map((todo, idx) => ({ todo, idx }));
			indexed.sort((a, b) => {
				if (Boolean(a.todo.completed) !== Boolean(b.todo.completed)) {
					return a.todo.completed ? 1 : -1;
				}
				const rankA = PRIORITY_META[a.todo.priority]?.rank ?? 1;
				const rankB = PRIORITY_META[b.todo.priority]?.rank ?? 1;
				if (rankA !== rankB) return rankA - rankB;
				return a.idx - b.idx;
			});

			todoList.innerHTML = indexed.map(({ todo, idx }) => {
				const icon = todo.icon || '📝';
				const color = todo.color || '#6366f1';
				const prio = PRIORITY_META[todo.priority] || PRIORITY_META.medium;
				return `
					<div class="jct-todo-item${todo.completed ? ' completed' : ''}" style="--todo-color: ${escapeHtml(color)};">
						<input type="checkbox" ${todo.completed ? 'checked' : ''} data-index="${idx}" class="jct-todo-check">
						<span class="jct-todo-icon" title="עדיפות ${escapeHtml(prio.label)}">${escapeHtml(icon)}</span>
						<div class="jct-todo-content" data-index="${idx}" title="לחץ לעריכה">
							<span class="jct-todo-text">${escapeHtml(todo.text)}</span>
							<span class="jct-todo-prio-badge" style="color:${prio.color}; background:${prio.color}1a;">${prio.label}</span>
						</div>
						<button type="button" data-index="${idx}" class="jct-todo-del" title="מחק משימה">🗑️</button>
					</div>
				`;
			}).join('');

			todoList.querySelectorAll('.jct-todo-check').forEach((checkbox) => {
				checkbox.addEventListener('change', async (e) => {
					const index = parseInt(e.target.dataset.index, 10);
					todos[index].completed = e.target.checked;
					await JCT.storage.saveTodos(todos);
					renderTodos();
				});
			});

			todoList.querySelectorAll('.jct-todo-content').forEach((contentEl) => {
				contentEl.addEventListener('click', async () => {
					const index = parseInt(contentEl.dataset.index, 10);
					const updated = await openTodoDialog(todos[index]);
					if (!updated) return;
					todos[index] = { ...todos[index], ...updated };
					await JCT.storage.saveTodos(todos);
					renderTodos();
				});
			});

			todoList.querySelectorAll('.jct-todo-del').forEach((btn) => {
				btn.addEventListener('click', async () => {
					const index = parseInt(btn.dataset.index, 10);
					todos.splice(index, 1);
					await JCT.storage.saveTodos(todos);
					renderTodos();
				});
			});
		}

		async function handleAddTodo() {
			const created = await openTodoDialog(null);
			if (!created) return;
			todos.push({ ...created, completed: false });
			await JCT.storage.saveTodos(todos);
			renderTodos();
		}

		todoAddBtn.addEventListener('click', handleAddTodo);
		renderTodos();
	}

	JCT.schedule = {
		showScheduleDayPicker,
		showTimePickerDialog,
		createWeeklyScheduleView,
		updateWeeklyScheduleView,
		initializeTodoList
	};
})(window.JCT = window.JCT || {});
