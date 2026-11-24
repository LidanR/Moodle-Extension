(function (JCT) {
	'use strict';

	const { DAYS_OF_WEEK, HEBREW_MONTHS } = JCT.config;
	const { escapeHtml, parseLocalDate, formatLocalDateInput } = JCT.utils;

	const EVENT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

	async function showCalendarModal() {
		if (document.querySelector('.jct-calendar-modal')) return;

		let customEvents = await JCT.storage.getCustomEvents();

		const today = new Date();
		let currentMonth = today.getMonth();
		let currentYear = today.getFullYear();

		const modal = document.createElement('div');
		modal.className = 'jct-calendar-modal';
		modal.innerHTML = `
			<div class="jct-calendar-modal-content">
				<div class="jct-calendar-modal-header">
					<h3>לוח שנה - מטלות ואירועים</h3>
					<button type="button" class="jct-calendar-modal-close">✕</button>
				</div>
				<div class="jct-calendar-controls">
					<button type="button" id="jct-cal-prev" class="jct-cal-nav-btn">→ קודם</button>
					<h4 id="jct-cal-month-year" style="margin: 0; font-size: 0.95rem;"></h4>
					<button type="button" id="jct-cal-next" class="jct-cal-nav-btn">הבא ←</button>
				</div>
				<div class="jct-calendar-body" id="jct-calendar-grid" style="padding: 8px; overflow-y: auto; flex: 1;"></div>
				<div class="jct-calendar-footer">
					<button type="button" id="jct-add-event-btn" class="jct-add-event-btn">➕ הוסף אירוע חדש</button>
				</div>
			</div>
		`;
		document.body.appendChild(modal);

		const closeModal = () => {
			modal.remove();
			JCT.schedule.updateWeeklyScheduleView();
		};

		modal.querySelector('.jct-calendar-modal-close').addEventListener('click', closeModal);
		modal.addEventListener('click', (e) => {
			if (e.target === modal) closeModal();
		});

		async function renderCalendar() {
			const grid = document.getElementById('jct-calendar-grid');
			const monthYearLabel = document.getElementById('jct-cal-month-year');
			if (!grid || !monthYearLabel) return;

			monthYearLabel.textContent = `${HEBREW_MONTHS[currentMonth]} ${currentYear}`;

			const firstDay = new Date(currentYear, currentMonth, 1);
			const lastDay = new Date(currentYear, currentMonth + 1, 0);
			const numDays = lastDay.getDate();
			const startingDayOfWeek = firstDay.getDay();

			const [{ cache }, dueDateCache, submissionStatusCache] = await Promise.all([
				JCT.storage.getAssignmentsCache(),
				JCT.storage.getDueDateCache(),
				JCT.storage.getSubmissionStatusCache()
			]);

			const allAssignments = [];
			if (cache && Array.isArray(cache.assignments)) {
				cache.assignments.forEach((assignment) => {
					const ts = dueDateCache[assignment.assignmentId];
					if (!ts) return;
					const dueDate = new Date(ts);
					if (isNaN(dueDate.getTime())) return;

					const cachedStatus = submissionStatusCache[`submission_status_${assignment.assignmentId}`];
					allAssignments.push({
						...assignment,
						dueDate,
						submissionStatus: cachedStatus ? cachedStatus.status : null,
						type: 'assignment'
					});
				});
			}

			const allEvents = [...allAssignments];
			customEvents.forEach((event) => {
				const parsed = parseLocalDate(event.date || event.startDate);
				if (!parsed) return;
				allEvents.push({
					...event,
					dueDate: parsed,
					type: 'custom'
				});
			});

			const dayHeadersHtml = DAYS_OF_WEEK.map(
				(d) => `<div class="jct-cal-weekday-header">${d}</div>`
			).join('');

			let html = `
				<div class="jct-cal-grid-wrap">
					<div class="jct-cal-weekdays">
						${dayHeadersHtml}
					</div>
					<div class="jct-cal-days-grid">
			`;

			for (let i = 0; i < startingDayOfWeek; i++) {
				html += '<div class="jct-cal-empty-cell"></div>';
			}

			const now = new Date();
			const todayStr = now.toDateString();

			for (let day = 1; day <= numDays; day++) {
				const currentDateObj = new Date(currentYear, currentMonth, day);
				const isToday = currentDateObj.toDateString() === todayStr;

				const dayEvents = allEvents.filter(
					(ev) =>
						ev.dueDate.getDate() === day &&
						ev.dueDate.getMonth() === currentMonth &&
						ev.dueDate.getFullYear() === currentYear
				);

				const hasEvents = dayEvents.length > 0;
				const dateIso = formatLocalDateInput(currentDateObj);

				html += `
					<div class="jct-calendar-day${isToday ? ' is-today' : ''}${hasEvents ? ' has-events' : ''}" data-day="${day}" data-month="${currentMonth}" data-year="${currentYear}" data-date="${dateIso}" title="${hasEvents ? 'לחץ לפרטים או על + להוספת אירוע' : 'לחץ להוספת אירוע ביום זה'}">
						<div class="jct-calendar-day-top">
							<span class="jct-calendar-day-num">${day}</span>
							<button type="button" class="jct-cal-quick-add" data-date="${dateIso}" title="הוסף אירוע ליום זה">+</button>
						</div>
						<div style="font-size: 0.5rem; overflow: hidden; flex: 1; display: flex; flex-direction: column; gap: 1px;">
				`;

				dayEvents.slice(0, 3).forEach((event) => {
					if (event.type === 'assignment') {
						const isOverdue = event.dueDate < now;
						const isSubmitted = event.submissionStatus === 'submitted';

						let color = '#2563eb';
						let statusIcon = event.submissionStatus === 'not_submitted' ? '✗' : '';
						if (isSubmitted) {
							color = '#16a34a';
							statusIcon = '✓';
						} else if (isOverdue) {
							color = '#eab308';
							statusIcon = '✗';
						}

						const shortName = event.assignmentName.length > 12
							? `${event.assignmentName.substring(0, 12)}..`
							: event.assignmentName;

						html += `
							<div style="background: ${color}; color: white; padding: 2px 4px; border-radius: 3px; font-size: 0.65rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; line-height: 1.3;">
								${statusIcon} ${escapeHtml(shortName)}
							</div>
						`;
					} else {
						const shortTitle = event.title.length > 12 ? `${event.title.substring(0, 12)}..` : event.title;
						const evColor = escapeHtml(event.color || '#22c55e');
						html += `
							<div style="background: ${evColor}; color: white; padding: 2px 4px; border-radius: 3px; font-size: 0.65rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; line-height: 1.3;">
								${escapeHtml(shortTitle)}
							</div>
						`;
					}
				});

				if (dayEvents.length > 3) {
					html += `
						<div style="font-size: 0.48rem; color: #64748b; text-align: center; margin-top: 1px; flex-shrink: 0;">
							+${dayEvents.length - 3}
						</div>
					`;
				}

				html += '</div></div>';
			}

			html += '</div></div>';
			grid.innerHTML = html;

			// Quick-add "+" button inside each day cell
			grid.querySelectorAll('.jct-cal-quick-add').forEach((btn) => {
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					openEventFormModal(null, btn.dataset.date);
				});
			});

			// Click ANY day cell: empty day -> add event directly; day with events -> open day details
			grid.querySelectorAll('.jct-calendar-day').forEach((dayEl) => {
				dayEl.addEventListener('click', () => {
					const day = parseInt(dayEl.dataset.day, 10);
					const month = parseInt(dayEl.dataset.month, 10);
					const year = parseInt(dayEl.dataset.year, 10);
					const dateIso = dayEl.dataset.date;
					const dayEvents = allEvents.filter(
						(ev) =>
							ev.dueDate.getDate() === day &&
							ev.dueDate.getMonth() === month &&
							ev.dueDate.getFullYear() === year
					);

					if (dayEvents.length === 0) {
						openEventFormModal(null, dateIso);
					} else {
						showDayDetailsModal(day, month, year, dayEvents, dateIso);
					}
				});
			});
		}

		function showDayDetailsModal(day, month, year, dayEvents, dateIso) {
			const detailsModal = document.createElement('div');
			detailsModal.className = 'jct-day-details-modal';

			const now = new Date();
			let eventsHtml = '';

			dayEvents.forEach((event) => {
				if (event.type === 'assignment') {
					const isOverdue = event.dueDate < now;
					const isSubmitted = event.submissionStatus === 'submitted';

					let statusBadge = '';
					if (isSubmitted) {
						statusBadge = '<span style="background: #16a34a; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-right: 8px;">✓ הוגש</span>';
					} else if (isOverdue) {
						statusBadge = '<span style="background: #eab308; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-right: 8px;">✗ לא הוגש (באיחור)</span>';
					} else if (event.submissionStatus === 'not_submitted') {
						statusBadge = '<span style="background: #2563eb; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-right: 8px;">✗ לא הוגש</span>';
					}

					const overdueText = isOverdue && !isSubmitted ? '<span style="color: #eab308; font-weight: 600;">(באיחור)</span>' : '';
					const borderCol = isSubmitted ? '#16a34a' : (isOverdue ? '#eab308' : '#2563eb');

					eventsHtml += `
						<div class="jct-day-event-card" style="border-right: 4px solid ${borderCol};">
							<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
								<h4 style="margin: 0; font-size: 1rem;">📝 ${escapeHtml(event.assignmentName)}</h4>
								${statusBadge}
							</div>
							<div class="jct-day-event-meta" style="margin-bottom: 4px;">
								<strong>קורס:</strong> ${escapeHtml(event.courseName)}
							</div>
							<div class="jct-day-event-meta" style="margin-bottom: 8px;">
								<strong>תאריך יעד:</strong> ${event.dueDate.toLocaleDateString('he-IL')} ${event.dueDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} ${overdueText}
							</div>
							<a href="${escapeHtml(event.assignmentUrl)}" target="_blank" style="display: inline-block; background: #2563eb; color: white; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-size: 0.875rem;">
								פתח מטלה
							</a>
						</div>
					`;
				} else {
					const evColor = escapeHtml(event.color || '#22c55e');
					eventsHtml += `
						<div class="jct-day-event-card is-custom" style="border-right: 4px solid ${evColor};">
							<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
								<h4 style="margin: 0; font-size: 1rem;">${escapeHtml(event.title)}</h4>
								<div>
									<button type="button" class="jct-edit-event-btn" data-event-id="${escapeHtml(event.id)}" style="background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-left: 4px; font-size: 0.75rem;">ערוך</button>
									<button type="button" class="jct-delete-event-btn" data-event-id="${escapeHtml(event.id)}" style="background: #dc2626; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">מחק</button>
								</div>
							</div>
							${event.description ? `<div class="jct-day-event-meta" style="margin-bottom: 4px;">${escapeHtml(event.description)}</div>` : ''}
							<div class="jct-day-event-meta">
								<strong>תאריך:</strong> ${event.dueDate.toLocaleDateString('he-IL')}
							</div>
						</div>
					`;
				}
			});

			detailsModal.innerHTML = `
				<div class="jct-day-details-card">
					<div class="jct-day-details-header">
						<h3>${day} ${HEBREW_MONTHS[month]} ${year}</h3>
						<button type="button" class="jct-close-details" style="background: #ef4444; color: white; border: none; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.25rem;">✕</button>
					</div>
					<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
						<span class="jct-day-event-meta">סה"כ ${dayEvents.length} ${dayEvents.length === 1 ? 'אירוע' : 'אירועים'}</span>
						<button type="button" class="jct-day-add-event-btn">➕ הוסף אירוע ליום זה</button>
					</div>
					${eventsHtml}
				</div>
			`;
			document.body.appendChild(detailsModal);

			detailsModal.querySelector('.jct-close-details').addEventListener('click', () => detailsModal.remove());
			detailsModal.addEventListener('click', (e) => {
				if (e.target === detailsModal) detailsModal.remove();
			});

			detailsModal.querySelector('.jct-day-add-event-btn').addEventListener('click', () => {
				detailsModal.remove();
				openEventFormModal(null, dateIso);
			});

			detailsModal.querySelectorAll('.jct-edit-event-btn').forEach((btn) => {
				btn.addEventListener('click', () => {
					const eventId = btn.dataset.eventId;
					detailsModal.remove();
					openEventFormModal(customEvents.find((ev) => ev.id === eventId) || null);
				});
			});

			detailsModal.querySelectorAll('.jct-delete-event-btn').forEach((btn) => {
				btn.addEventListener('click', async () => {
					const eventId = btn.dataset.eventId;
					if (!confirm('האם אתה בטוח שברצונך למחוק אירוע זה?')) return;
					const index = customEvents.findIndex((ev) => ev.id === eventId);
					if (index !== -1) {
						customEvents.splice(index, 1);
						await JCT.storage.saveCustomEvents(customEvents);
						detailsModal.remove();
						renderCalendar();
					}
				});
			});
		}

		function openEventFormModal(existingEvent = null, prefillDate = null) {
			const isEdit = Boolean(existingEvent);
			const defaultDate = existingEvent
				? existingEvent.date
				: (prefillDate || formatLocalDateInput(new Date()));
			let selectedColor = existingEvent?.color || EVENT_COLORS[0];

			const eventModal = document.createElement('div');
			eventModal.className = 'jct-event-edit-modal';
			eventModal.innerHTML = `
				<div class="jct-event-edit-content">
					<h3 style="margin-top: 0;">${isEdit ? 'ערוך אירוע' : 'הוסף אירוע חדש'}</h3>
					<div style="margin-bottom: 14px;">
						<label style="display: block; margin-bottom: 4px; font-weight: 500;">שם האירוע:</label>
						<input type="text" id="jct-event-title" value="${escapeHtml(existingEvent ? existingEvent.title : '')}" style="width: 100%; padding: 8px; border-radius: 6px; box-sizing: border-box;" placeholder="לדוגמה: פגישה עם מרצה">
					</div>
					<div style="margin-bottom: 14px;">
						<label style="display: block; margin-bottom: 4px; font-weight: 500;">תאריך:</label>
						<input type="date" id="jct-event-date" value="${escapeHtml(defaultDate)}" style="width: 100%; padding: 8px; border-radius: 6px; box-sizing: border-box;">
					</div>
					<div style="margin-bottom: 14px;">
						<label style="display: block; margin-bottom: 6px; font-weight: 500;">צבע תווית:</label>
						<div class="jct-event-color-row">
							${EVENT_COLORS.map((hex) => `
								<button type="button" class="jct-todo-color-opt${hex === selectedColor ? ' active' : ''}" data-color="${hex}" style="background:${hex};"></button>
							`).join('')}
						</div>
					</div>
					<div style="margin-bottom: 16px;">
						<label style="display: block; margin-bottom: 4px; font-weight: 500;">תיאור (אופציונלי):</label>
						<textarea id="jct-event-description" style="width: 100%; padding: 8px; border-radius: 6px; min-height: 80px; box-sizing: border-box;" placeholder="תיאור האירוע...">${escapeHtml(existingEvent ? existingEvent.description || '' : '')}</textarea>
					</div>
					<div style="display: flex; gap: 12px; justify-content: flex-end;">
						<button type="button" id="jct-event-cancel" style="padding: 8px 16px; background: #94a3b8; color: white; border: none; border-radius: 6px; cursor: pointer;">ביטול</button>
						<button type="button" id="jct-event-save" style="padding: 8px 16px; background: #22c55e; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">שמור</button>
					</div>
				</div>
			`;
			document.body.appendChild(eventModal);

			const titleInput = eventModal.querySelector('#jct-event-title');
			setTimeout(() => titleInput?.focus(), 20);

			eventModal.querySelectorAll('.jct-todo-color-opt').forEach((btn) => {
				btn.addEventListener('click', () => {
					selectedColor = btn.dataset.color;
					eventModal.querySelectorAll('.jct-todo-color-opt').forEach((b) => b.classList.remove('active'));
					btn.classList.add('active');
				});
			});

			eventModal.querySelector('#jct-event-cancel').addEventListener('click', () => eventModal.remove());
			eventModal.addEventListener('click', (e) => {
				if (e.target === eventModal) eventModal.remove();
			});

			eventModal.querySelector('#jct-event-save').addEventListener('click', async () => {
				const title = titleInput.value.trim();
				const date = eventModal.querySelector('#jct-event-date').value;
				const description = eventModal.querySelector('#jct-event-description').value.trim();

				if (!title || !date) {
					alert('נא למלא שם ותאריך לאירוע');
					return;
				}

				if (isEdit) {
					existingEvent.title = title;
					existingEvent.date = date;
					existingEvent.description = description;
					existingEvent.color = selectedColor;
				} else {
					customEvents.push({
						id: Date.now().toString(),
						title,
						date,
						description,
						color: selectedColor
					});
				}

				await JCT.storage.saveCustomEvents(customEvents);
				eventModal.remove();
				renderCalendar();
			});
		}

		document.getElementById('jct-cal-prev').addEventListener('click', () => {
			currentMonth--;
			if (currentMonth < 0) {
				currentMonth = 11;
				currentYear--;
			}
			renderCalendar();
		});

		document.getElementById('jct-cal-next').addEventListener('click', () => {
			currentMonth++;
			if (currentMonth > 11) {
				currentMonth = 0;
				currentYear++;
			}
			renderCalendar();
		});

		document.getElementById('jct-add-event-btn').addEventListener('click', () => openEventFormModal(null));

		await renderCalendar();
	}

	JCT.modals = JCT.modals || {};
	JCT.modals.showCalendarModal = showCalendarModal;
})(window.JCT = window.JCT || {});
