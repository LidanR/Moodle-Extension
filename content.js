// Inject small runtime tweaks after CSS applies
(function () {
	const docReady = (fn) => {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', fn, { once: true });
		} else {
			fn();
		}
	};

	const HEBREW_YEARS = [5784,5785,5786,5787,5788,5789,5790];
	const SEM_TO_IDX = {'אלול':0, '1':0, 'א':1, '2':1, 'ב':2, '3':2};
	const DEFAULT_PALETTE = [
		["#3b82f6","#818cf8","#bae6fd"], // 5784
		["#22c55e","#4ade80","#bbf7d0"], // 5785
		["#f97316","#fbbf24","#fed7aa"], // 5786
		["#f43f5e","#fda4af","#fecdd3"], // 5787
		["#a21caf","#f472b6","#f3e8ff"], // 5788
		["#2563eb","#60a5fa","#dbeafe"], // 5789
		["#b45309","#f59e42","#fde68a"]  // 5790
	];
	let paletteByYearHeb = null;
	let favoriteCourseIds = new Set();
	let courseSchedules = {};
	let courseAssignments = {}; // Store assignments by courseId
	const processedCards = new WeakSet();
	let isReordering = false;
	let scheduled = false;
	let scheduleViewVisible = false;
	let saveSchedulesTimeout = null;
	let isSavingSchedules = false;

	function scheduleLightUpdate() {
		if (scheduled || isReordering) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			markCoursesContainers();
			ensureStructureAndColor();
			refreshFavoritesUI();
			// Don't update schedule view here - it causes event listeners to be lost
			// Only update if schedule is visible and we need to refresh
			if (scheduleViewVisible) {
				// Only update if container exists and is visible
				const container = document.getElementById('jct-weekly-schedule');
				if (container && container.style.display !== 'none') {
					// Use a debounced update to avoid constant refreshing
					clearTimeout(scheduleUpdateTimeout);
					scheduleUpdateTimeout = setTimeout(() => {
						updateWeeklyScheduleView();
					}, 500);
				}
			}
		});
	}
	
	let scheduleUpdateTimeout = null;

	function loadFavorites() {
		return new Promise((resolve) => {
			try {
				chrome.storage.sync.get({ favoriteCourseIds: [] }, (res) => {
					const arr = Array.isArray(res.favoriteCourseIds) ? res.favoriteCourseIds : [];
					favoriteCourseIds = new Set(arr.map(String));
					resolve(favoriteCourseIds);
				});
			} catch (_e) { resolve(favoriteCourseIds); }
		});
	}

	function loadCourseSchedules() {
		return new Promise((resolve) => {
			try {
				// Try local first, then sync
				chrome.storage.local.get({ courseSchedules: {}, scheduleViewVisible: false }, (res) => {
					if (chrome.runtime.lastError) {
						// Try sync as fallback
						chrome.storage.sync.get({ courseSchedules: {}, scheduleViewVisible: false }, (res2) => {
							if (chrome.runtime.lastError) {
								console.error('Error loading schedules:', chrome.runtime.lastError);
								resolve(courseSchedules);
								return;
							}
							courseSchedules = res2.courseSchedules || {};
							scheduleViewVisible = res2.scheduleViewVisible || false;
							const beforeMigration = JSON.stringify(courseSchedules);
							migrateSchedules();
							const afterMigration = JSON.stringify(courseSchedules);
							// Save if migration changed something
							if (beforeMigration !== afterMigration) {
								saveCourseSchedules();
							}
							resolve(courseSchedules);
						});
						return;
					}
					courseSchedules = res.courseSchedules || {};
					scheduleViewVisible = res.scheduleViewVisible || false;
					const beforeMigration = JSON.stringify(courseSchedules);
					migrateSchedules();
					const afterMigration = JSON.stringify(courseSchedules);
					// Save if migration changed something
					if (beforeMigration !== afterMigration) {
						saveCourseSchedules();
					}
					resolve(courseSchedules);
				});
			} catch (e) {
				console.error('Error in loadCourseSchedules:', e);
				resolve(courseSchedules);
			}
		});
	}

	function loadCourseAssignments() {
		return new Promise((resolve) => {
			try {
				chrome.storage.local.get({ courseAssignments: {} }, (res) => {
					if (chrome.runtime.lastError) {
						chrome.storage.sync.get({ courseAssignments: {} }, (res2) => {
							courseAssignments = res2.courseAssignments || {};
							resolve(courseAssignments);
						});
						return;
					}
					courseAssignments = res.courseAssignments || {};
					resolve(courseAssignments);
				});
			} catch (e) {
				console.error('Error in loadCourseAssignments:', e);
				resolve(courseAssignments);
			}
		});
	}

	function saveCourseAssignments() {
		return new Promise((resolve) => {
			try {
				chrome.storage.local.set({ courseAssignments: courseAssignments }, () => {
					if (chrome.runtime.lastError) {
						chrome.storage.sync.set({ courseAssignments: courseAssignments }, () => resolve());
					} else {
						resolve();
					}
				});
			} catch (e) {
				console.error('Error saving assignments:', e);
				resolve();
			}
		});
	}

	async function fetchAssignmentsForCourse(courseId) {
		if (!courseId) {
			return [];
		}
		
		try {
			// Check if we have cached data that's less than 5 minutes old
			if (courseAssignments[courseId] && courseAssignments[courseId]._timestamp) {
				const age = Date.now() - courseAssignments[courseId]._timestamp;
				if (age < 5 * 60 * 1000) { // 5 minutes
					return courseAssignments[courseId].assignments || [];
				}
			}

			// Get Moodle config from window - wait longer if not ready
			let moodleCfg = window.M?.cfg;
			
			// Try multiple times to get the config
			if (!moodleCfg) {
				for (let i = 0; i < 10; i++) {
					await new Promise(resolve => setTimeout(resolve, 200));
					moodleCfg = window.M?.cfg;
					if (moodleCfg && moodleCfg.sesskey && moodleCfg.wwwroot) {
						break;
					}
				}
			}
			
			// If still not found, try to get wwwroot from current URL
			if (!moodleCfg || !moodleCfg.wwwroot) {
				const currentUrl = window.location.origin + window.location.pathname.split('/').slice(0, -1).join('/');
				if (currentUrl.includes('moodle')) {
					moodleCfg = moodleCfg || {};
					moodleCfg.wwwroot = currentUrl;
				}
			}
			
			// Try to get sesskey from the page
			if (!moodleCfg || !moodleCfg.sesskey) {
				const sesskeyInput = document.querySelector('input[name="sesskey"]');
				if (sesskeyInput) {
					moodleCfg = moodleCfg || {};
					moodleCfg.sesskey = sesskeyInput.value;
				}
			}
			
			if (!moodleCfg || !moodleCfg.wwwroot) {
				if (courseAssignments[courseId] && courseAssignments[courseId].assignments) {
					return courseAssignments[courseId].assignments;
				}
				return [];
			}

			// Try multiple approaches to get assignments
			
			// Approach 1: Try Moodle AJAX API
			try {
				const apiUrl = `${moodleCfg.wwwroot}/lib/ajax/service.php`;
				const requestData = [{
					index: 0,
					methodname: 'core_course_get_contents',
					args: {
						courseid: parseInt(courseId)
					}
				}];

				const requestBody = moodleCfg.sesskey 
					? { sesskey: moodleCfg.sesskey, info: requestData }
					: { info: requestData };

				const response = await fetch(apiUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					credentials: 'include',
					body: JSON.stringify(requestBody)
				});

				if (response.ok) {
					const data = await response.json();
					
					if (data && data[0] && !data[0].error && data[0].data) {
						const sections = Array.isArray(data[0].data) ? data[0].data : [];
						const assignments = [];
						
						// Parse sections to find assignments
						sections.forEach(section => {
							if (section.modules && Array.isArray(section.modules)) {
								section.modules.forEach(module => {
									if (module.modname === 'assign' && module.id) {
										// Find due date
										let dueDate = null;
										if (module.dates && Array.isArray(module.dates)) {
											// Look for due date (could be labeled in Hebrew or English)
											const dueDateObj = module.dates.find(d => 
												d && d.label && (
													d.label.includes('תאריך') || 
													d.label.includes('Due') || 
													d.label.includes('due') ||
													d.label.includes('תאריך הגשה') ||
													d.label.includes('תאריך סיום')
												)
											);
											if (dueDateObj && dueDateObj.timestamp) {
												dueDate = Math.floor(dueDateObj.timestamp);
											} else if (module.dates[0] && module.dates[0].timestamp) {
												dueDate = Math.floor(module.dates[0].timestamp);
											}
										}
										
										// Also check module.duedate if available
										if (!dueDate && module.duedate) {
											dueDate = Math.floor(module.duedate);
										}
										
										// Ensure URL points to assignment view
										let moduleUrl = module.url || `${moodleCfg.wwwroot}/mod/assign/view.php?id=${module.id}`;
										if (!moduleUrl.includes('/mod/assign/view.php')) {
											moduleUrl = `${moodleCfg.wwwroot}/mod/assign/view.php?id=${module.id}`;
										}
										
										// Check if assignment is submitted
										let isSubmitted = false;
										if (module.completiondata && module.completiondata.state === 1) {
											isSubmitted = true;
										} else if (module.completion && module.completion === 1) {
											isSubmitted = true;
										}
										
										assignments.push({
											id: String(module.id),
											name: module.name || 'מטלה ללא שם',
											duedate: dueDate,
											url: moduleUrl,
											submission: isSubmitted ? { status: 'submitted' } : null
										});
									}
								});
							}
						});
						
						if (assignments.length > 0) {
							courseAssignments[courseId] = {
								assignments: assignments,
								_timestamp: Date.now()
							};
						saveCourseAssignments().catch(() => {});
						return assignments;
						}
					}
				}
			} catch (apiError) {
				// API failed, try page fetch
			}
			
			// Approach 2: Try to fetch course page (may fail due to CORS)
			try {
				const courseUrl = `${moodleCfg.wwwroot}/course/view.php?id=${courseId}`;
				const response = await fetch(courseUrl, {
					method: 'GET',
					credentials: 'include'
				});
				
				if (response.ok) {
					const html = await response.text();
					const parser = new DOMParser();
					const doc = parser.parseFromString(html, 'text/html');
					
					// Find assignment links
					const assignmentLinks = doc.querySelectorAll('a[href*="/mod/assign/view.php"]');
					const assignments = [];
					
					assignmentLinks.forEach(link => {
						const href = link.getAttribute('href');
						const match = href.match(/[?&]id=(\d+)/);
						if (match) {
							const assignId = match[1];
							const name = link.textContent.trim() || link.innerText.trim();
							
							// Try to find due date - multiple approaches
							let dueDate = null;
							
							// Approach 1: Look in parent elements
							const parent = link.closest('.activity, .modtype_assign, li, .course-content, .activityinstance, .activity-item');
							if (parent) {
								// Try to find date in various formats
								const dateText = parent.textContent || parent.innerText || '';
								
								// Hebrew date format: DD/MM/YYYY
								let dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
								if (dateMatch) {
									const [_, day, month, year] = dateMatch;
									dueDate = Math.floor(new Date(`${year}-${month}-${day}`).getTime() / 1000);
								} else {
									// Try YYYY-MM-DD format
									dateMatch = dateText.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
									if (dateMatch) {
										const [_, year, month, day] = dateMatch;
										dueDate = Math.floor(new Date(`${year}-${month}-${day}`).getTime() / 1000);
									} else {
										// Try to find data attributes
										const dateAttr = parent.getAttribute('data-duedate') || 
											parent.querySelector('[data-duedate]')?.getAttribute('data-duedate');
										if (dateAttr) {
											dueDate = parseInt(dateAttr);
										}
									}
								}
							}
							
							// Approach 2: Look for date in nearby text elements
							if (!dueDate) {
								// Check siblings and nearby elements
								let current = link.parentElement;
								for (let i = 0; i < 5 && current; i++) {
									const text = current.textContent || '';
									// Look for various date patterns
									let dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
									if (dateMatch) {
										const [_, day, month, year] = dateMatch;
										dueDate = Math.floor(new Date(`${year}-${month}-${day}`).getTime() / 1000);
										break;
									}
									dateMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
									if (dateMatch) {
										const [_, year, month, day] = dateMatch;
										dueDate = Math.floor(new Date(`${year}-${month}-${day}`).getTime() / 1000);
										break;
									}
									current = current.parentElement;
								}
							}
							
							// Approach 3: Try to fetch assignment page (async, don't block) to check submission status
							// This will be done in background and cached for next time
							if (assignId) {
								// Fetch in background and update cache
								fetch(`${moodleCfg.wwwroot}/mod/assign/view.php?id=${assignId}`, {
									method: 'GET',
									credentials: 'include'
								}).then(response => {
									if (response.ok) {
										return response.text();
									}
								}).then(html => {
									if (html) {
										const parser = new DOMParser();
										const doc = parser.parseFromString(html, 'text/html');
										
										// Check if assignment is submitted
										let isSubmitted = false;
										const pageText = doc.body.textContent || doc.body.innerText || '';
										if (pageText.includes('הוגש') || pageText.includes('הושלם') || 
											pageText.includes('Submitted') || pageText.includes('Complete') ||
											doc.querySelector('.submissionstatussubmitted, .submission-status-submitted, [class*="submitted"], [id*="submitted"]')) {
											isSubmitted = true;
										}
										
										// Look for due date in various places
										const dueDateEl = doc.querySelector('[data-duedate], .duedate, .assignment-due-date, [class*="due"], [id*="duedate"]');
										if (dueDateEl) {
											let dateText = dueDateEl.textContent || dueDateEl.getAttribute('data-duedate');
											if (!dateText) {
												dateText = dueDateEl.getAttribute('title') || dueDateEl.getAttribute('aria-label');
											}
											
											if (dateText) {
												let dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
												if (dateMatch) {
													const [_, day, month, year] = dateMatch;
													const timestamp = Math.floor(new Date(`${year}-${month}-${day}`).getTime() / 1000);
													// Update cached assignment
													if (courseAssignments[courseId] && courseAssignments[courseId].assignments) {
														const assign = courseAssignments[courseId].assignments.find(a => a.id === assignId);
														if (assign) {
															assign.duedate = timestamp;
															if (isSubmitted) {
																assign.submission = { status: 'submitted' };
															}
															saveCourseAssignments().catch(() => {});
														}
													}
												}
											}
										} else if (isSubmitted) {
											// Update submission status even if no date found
											if (courseAssignments[courseId] && courseAssignments[courseId].assignments) {
												const assign = courseAssignments[courseId].assignments.find(a => a.id === assignId);
												if (assign) {
													assign.submission = { status: 'submitted' };
													saveCourseAssignments().catch(() => {});
												}
											}
										}
									}
								}).catch(() => {});
							}
							
							// Fix URL - make sure it's absolute and points to the assignment
							let finalUrl = href;
							if (!href.startsWith('http')) {
								if (href.startsWith('/')) {
									finalUrl = `${moodleCfg.wwwroot}${href}`;
								} else {
									finalUrl = `${moodleCfg.wwwroot}/${href}`;
								}
							}
							
							// Ensure URL points to assignment view, not course
							if (!finalUrl.includes('/mod/assign/view.php')) {
								finalUrl = `${moodleCfg.wwwroot}/mod/assign/view.php?id=${assignId}`;
							}
							
							// Check if assignment is submitted by looking at the link or parent element
							let isSubmitted = false;
							const parentEl = link.closest('.activity, .modtype_assign, li, .course-content, .activityinstance, .activity-item');
							if (parentEl) {
								const parentText = parentEl.textContent || parentEl.innerText || '';
								// Look for Hebrew indicators of submission
								if (parentText.includes('הוגש') || parentText.includes('הושלם') || 
									parentText.includes('Submitted') || parentText.includes('Complete') ||
									parentEl.classList.contains('completed') || parentEl.classList.contains('submitted') ||
									parentEl.querySelector('.submissionstatussubmitted, .submission-status-submitted, [class*="submitted"]')) {
									isSubmitted = true;
								}
							}
							
							assignments.push({
								id: assignId,
								name: name,
								duedate: dueDate,
								url: finalUrl,
								submission: isSubmitted ? { status: 'submitted' } : null
							});
						}
					});
					
					if (assignments.length > 0) {
						courseAssignments[courseId] = {
							assignments: assignments,
							_timestamp: Date.now()
						};
						saveCourseAssignments().catch(() => {});
						return assignments;
					}
				}
			} catch (fetchError) {
				// Page fetch failed
			}
			
			// Return cached data if available
			if (courseAssignments[courseId] && courseAssignments[courseId].assignments) {
				return courseAssignments[courseId].assignments;
			}
			return [];
		} catch (error) {
			console.error('Error fetching assignments for course', courseId, error);
			if (courseAssignments[courseId] && courseAssignments[courseId].assignments) {
				return courseAssignments[courseId].assignments;
			}
			return [];
		}
	}
	
	function saveScheduleViewState() {
		try {
			chrome.storage.local.set({ scheduleViewVisible: scheduleViewVisible }, () => {
				if (chrome.runtime.lastError) {
					chrome.storage.sync.set({ scheduleViewVisible: scheduleViewVisible });
				}
			});
		} catch (e) {
			// Ignore
		}
	}
	
	function migrateSchedules() {
		// Migrate old format if needed and remove saturday
		Object.keys(courseSchedules).forEach(courseId => {
			if (Array.isArray(courseSchedules[courseId])) {
				// Old format: just array of days
				const days = courseSchedules[courseId];
				courseSchedules[courseId] = { days: days, name: `קורס ${courseId}` };
			}
			// Remove saturday from all courses
			if (courseSchedules[courseId].days) {
				courseSchedules[courseId].days = courseSchedules[courseId].days.filter(day => day !== 'saturday');
				// Remove course if no days left
				if (courseSchedules[courseId].days.length === 0) {
					delete courseSchedules[courseId];
				}
			}
		});
	}

	function saveFavorites() {
		try {
			chrome.storage.sync.set({ favoriteCourseIds: Array.from(favoriteCourseIds) });
		} catch (_e) { /* ignore */ }
	}

	function isFavorite(courseId) { return courseId && favoriteCourseIds.has(String(courseId)); }

	function toggleFavorite(courseId) {
		if (!courseId) return;
		const key = String(courseId);
		if (favoriteCourseIds.has(key)) favoriteCourseIds.delete(key); else favoriteCourseIds.add(key);
		saveFavorites();
		refreshFavoritesUI();
	}

	function getCourseIdFromCard(card) {
		let mainLink = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a');
		if (mainLink && mainLink.href) {
			const m = mainLink.href.match(/[?&]id=(\d+)/);
			if (m) return m[1];
		}
		const idFromAttr = card.getAttribute('data-course-id') || card.dataset.courseId;
		if (idFromAttr) return String(idFromAttr);
		return null;
	}

	function getCourseNameFromCard(card) {
		const nameEl = card.querySelector('.coursename a, .course-title a, .list-group-item a.course-title, .list-group-item .coursename a');
		if (nameEl) {
			return nameEl.textContent.trim() || nameEl.innerText.trim();
		}
		return card.textContent.trim().split('\n')[0] || 'קורס ללא שם';
	}

	function refreshFavoritesUI() {
		// Update star icons and reorder containers
		isReordering = true;
		try { document.querySelectorAll('.jct-courses-grid').forEach(reorderContainerByFavorites); }
		finally { isReordering = false; }
		document.querySelectorAll('.jct-fav-toggle').forEach((btn) => {
			const card = btn.closest('.list-group-item, .coursebox, .card.course, li, .dashboard-card');
			const cid = card ? getCourseIdFromCard(card) : null;
			btn.classList.toggle('jct-fav-on', isFavorite(cid));
			btn.setAttribute('aria-pressed', isFavorite(cid) ? 'true' : 'false');
			btn.textContent = isFavorite(cid) ? '★' : '☆';
			if (card) card.setAttribute('data-jct-fav', isFavorite(cid) ? '1' : '0');
		});
	}

	function hexToHsl(hex) {
		hex = (hex || '').replace('#','');
		if (!hex) return { h: 220, s: 60, l: 60 };
		if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
		const r = parseInt(hex.substring(0,2),16) / 255;
		const g = parseInt(hex.substring(2,4),16) / 255;
		const b = parseInt(hex.substring(4,6),16) / 255;
		const max = Math.max(r,g,b), min = Math.min(r,g,b);
		let h, s, l = (max + min) / 2;
		if (max === min) { h = 0; s = 0; }
		else {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h *= 60;
		}
		h = Math.round(h % 360);
		s = Math.round((s || 0) * 100);
		l = Math.round(l * 100);
		return { h, s: Math.max(35, Math.min(90, s)), l: Math.max(35, Math.min(70, l)) };
	}

	function loadPaletteHeb() {
		return new Promise((resolve) => {
			chrome.storage.sync.get({ paletteByYearHeb: null }, res => {
				if (Array.isArray(res.paletteByYearHeb)) paletteByYearHeb = res.paletteByYearHeb;
				else paletteByYearHeb = null;
				resolve(paletteByYearHeb);
			});
		});
	}

	function parseHebrewYearAndSemester(txt) {
		let y, s;
		// Detect Hebrew year
		const yMatch = txt.match(/תש[פצ]["']?[דוהזחטצ]/);
		if (yMatch) {
			const lookup = {'תשפ"ד':5784,'תשפ"ה':5785,'תשפ"ו':5786,'תשפ"ז':5787,'תשפ"ח':5788,'תשפ"ט':5789,'תש"צ':5790};
			const cy = yMatch[0].replace("'",'"');
			y = lookup[cy];
		}
		if (!y) {
			const nMatch = txt.match(/57[8-9][0-9]/);
			y = nMatch ? parseInt(nMatch[0],10) : null;
		}
		// Detect semester
		let sMatch = null;
		if (txt.includes('אלול')) s = 0;
		else if ((sMatch = txt.match(/(?<=^|\W)(א|ב|1|2|3)(?=\W|$)/))) s = SEM_TO_IDX[sMatch[1]];
		else s = null;
		return {year: y, semIdx: s};
	}

	function colorFor(year, semIdx) {
		// Use DEFAULT_PALETTE if paletteByYearHeb is not loaded yet
		const palette = Array.isArray(paletteByYearHeb) ? paletteByYearHeb : DEFAULT_PALETTE;
		const row = HEBREW_YEARS.indexOf(year);
		if (row === -1 || semIdx == null) return { h: 220, s: 60, l: 60 };
		let hex = palette[row] && palette[row][semIdx];
		if (!hex) hex = "#cccccc";
		return hexToHsl(hex);
	}

	const CARD_STYLE_SELECTOR = '.list-group-item, .coursebox, .card.course, .course-list > li';

	function getStyledCardEl(card) {
		if (!card) return null;
		if (card.matches && card.matches(CARD_STYLE_SELECTOR)) return card;
		return card.querySelector(CARD_STYLE_SELECTOR) || card;
	}

	async function updateAssignmentsDisplay(card, courseId) {
		if (!courseId) {
			return;
		}
		
		// Skip if already processed
		if (card.hasAttribute('data-jct-assignments-processed')) {
			return;
		}
		card.setAttribute('data-jct-assignments-processed', 'true');
		
		try {
			let assignmentsContainer = card.querySelector('.jct-assignments-container');
			if (!assignmentsContainer) {
				assignmentsContainer = document.createElement('div');
				assignmentsContainer.className = 'jct-assignments-container';
				assignmentsContainer.style.display = 'none';
				// Insert after the course name/link but before other content
				const courseNameEl = card.querySelector('.coursename, .course-title, a[href*="/course/view.php"]');
				if (courseNameEl && courseNameEl.parentElement) {
					courseNameEl.parentElement.insertBefore(assignmentsContainer, courseNameEl.nextSibling);
				} else {
					// Fallback: add at the end of card
					card.appendChild(assignmentsContainer);
				}
			}

			// Try to fetch assignments
			const assignments = await fetchAssignmentsForCourse(courseId);
			
			if (!assignments || assignments.length === 0) {
				assignmentsContainer.innerHTML = '';
				assignmentsContainer.style.display = 'none';
				return;
			}

			// Filter assignments: only show relevant ones (not submitted, with due date or recent)
			const now = Math.floor(Date.now() / 1000);
			const sevenDaysFromNow = now + (7 * 24 * 60 * 60); // Show only next 7 days
			
			// Get max days for overdue assignments from settings
			let maxOverdueDays = 30; // Default: 30 days
			try {
				const settings = await new Promise(resolve => {
					chrome.storage.sync.get({ maxOverdueDays: 30 }, res => resolve(res));
				});
				maxOverdueDays = settings.maxOverdueDays || 30;
			} catch (e) {
				// Use default
			}
			const maxOverdueTimestamp = now - (maxOverdueDays * 24 * 60 * 60);
			
			// Filter out submitted assignments and very old overdue assignments
			const activeAssignments = assignments.filter(a => {
				if (!a) return false;
				// Skip if submitted
				if (a.submission && a.submission.status === 'submitted') return false;
				// Skip if overdue for more than maxOverdueDays
				if (a.duedate && a.duedate > 0 && a.duedate < now && a.duedate < maxOverdueTimestamp) {
					return false;
				}
				return true;
			});
			
			// Separate by due date
			const assignmentsWithDueDates = activeAssignments
				.filter(a => a.duedate && a.duedate > 0)
				.sort((a, b) => a.duedate - b.duedate);
			
			// Show only urgent assignments (next 7 days) or overdue
			const urgentAssignments = assignmentsWithDueDates.filter(a => 
				a.duedate <= sevenDaysFromNow // Includes overdue and upcoming within 7 days
			);
			
			// Always show only 1 assignment initially (unless user clicks "Show All")
			let assignmentsToShow = [];
			if (urgentAssignments.length > 0) {
				assignmentsToShow = urgentAssignments.slice(0, 1); // Only 1 urgent assignment
			} else {
				// No urgent assignments, show first assignment without date
				const assignmentsWithoutDueDates = activeAssignments
					.filter(a => (!a.duedate || a.duedate <= 0))
					.slice(0, 1);
				assignmentsToShow = assignmentsWithoutDueDates;
			}

			if (assignmentsToShow.length === 0) {
				assignmentsContainer.innerHTML = '';
				assignmentsContainer.style.display = 'none';
				return;
			}

			// Build HTML with carousel functionality
			// Store references for toggle functionality
			const allActiveAssignmentsRef = activeAssignments;
			const assignmentsToShowRef = assignmentsToShow;
			const nowRef = now;
			const hasMore = allActiveAssignmentsRef.length > assignmentsToShowRef.length;
			
			let html = '<div class="jct-assignments-header">';
			html += '<span class="jct-assignments-title">📝 מטלות קרובות</span>';
			if (hasMore) {
				html += `<button class="jct-assignments-toggle" data-expanded="false" style="display: inline-block !important; visibility: visible !important; opacity: 1 !important;">הצג הכל (${allActiveAssignmentsRef.length})</button>`;
			}
			html += '</div>';
			html += '<div class="jct-assignments-list">';
			
			// Show all assignments when expanded
			const assignmentsToRender = assignmentsToShow;
			
			assignmentsToRender.forEach(assign => {
				if (!assign || !assign.name) return;
				
				try {
					let dueDate = null;
					let daysUntilDue = null;
					let isOverdue = false;
					let isUrgent = false;
					let dateStr = '';
					
					if (assign.duedate && assign.duedate > 0) {
						dueDate = new Date(assign.duedate * 1000);
						daysUntilDue = Math.ceil((assign.duedate - now) / (24 * 60 * 60));
						isOverdue = assign.duedate < now;
						isUrgent = daysUntilDue <= 3 && !isOverdue;
						dateStr = dueDate.toLocaleDateString('he-IL', { 
							day: 'numeric', 
							month: 'numeric',
							year: 'numeric'
						});
					}
					
					const isSubmitted = assign.submission && assign.submission.status === 'submitted';
					
					let statusClass = '';
					let statusText = '';
					if (isSubmitted) {
						statusClass = 'jct-assignment-submitted';
						statusText = '✓ הוגש';
					} else if (isOverdue) {
						statusClass = 'jct-assignment-overdue';
						statusText = '⚠️ איחור';
					} else if (isUrgent) {
						statusClass = 'jct-assignment-urgent';
						statusText = `⏰ ${daysUntilDue} ימים`;
					} else if (daysUntilDue !== null) {
						statusClass = 'jct-assignment-upcoming';
						statusText = `${daysUntilDue} ימים`;
					} else {
						statusClass = 'jct-assignment-upcoming';
						statusText = 'ללא תאריך';
					}

					const safeName = (assign.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
					const safeUrl = assign.url || '';

					html += `<div class="jct-assignment-item ${statusClass}" data-assignment-url="${safeUrl ? safeUrl.replace(/"/g, '&quot;') : ''}">`;
					html += `<div class="jct-assignment-name">${safeName}</div>`;
					html += `<div class="jct-assignment-meta">`;
					if (dateStr) {
						html += `<span class="jct-assignment-date">${dateStr}</span>`;
					}
					html += `<span class="jct-assignment-status">${statusText}</span>`;
					html += `</div>`;
					if (safeUrl) {
						html += `<a href="${safeUrl}" class="jct-assignment-link" target="_blank" data-href="${safeUrl}">פתח →</a>`;
					}
					html += `</div>`;
				} catch (e) {
					console.error('Error processing assignment:', e, assign);
				}
			});

			// Show count of remaining assignments if there are more
			const remainingCount = activeAssignments.length - assignmentsToShow.length;
			if (remainingCount > 0) {
				html += `<div class="jct-assignments-more">+${remainingCount} מטלות נוספות</div>`;
			}

			html += '</div>';
			assignmentsContainer.innerHTML = html;
			assignmentsContainer.style.display = 'block';
			
			// Add click handlers to all links in initial HTML
			const allLinks = assignmentsContainer.querySelectorAll('.jct-assignment-link');
			allLinks.forEach(link => {
				link.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					let href = link.getAttribute('href') || link.getAttribute('data-href');
					// Fix URL if needed
					if (href && !href.includes('/mod/assign/view.php')) {
						const urlMatch = href.match(/[?&]id=(\d+)/);
						if (urlMatch) {
							href = `${window.location.origin}/mod/assign/view.php?id=${urlMatch[1]}`;
						}
					}
					if (href) {
						window.location.href = href;
					}
				});
			});
			
			// Helper function to create assignment element
			const createAssignmentElement = (assign, now) => {
				if (!assign) {
					return null;
				}
				const div = document.createElement('div');
				
				let dueDate = null;
				let daysUntilDue = null;
				let isOverdue = false;
				let isUrgent = false;
				let dateStr = '';
				
				if (assign.duedate && assign.duedate > 0) {
					dueDate = new Date(assign.duedate * 1000);
					daysUntilDue = Math.ceil((assign.duedate - now) / (24 * 60 * 60));
					isOverdue = assign.duedate < now;
					isUrgent = daysUntilDue <= 3 && !isOverdue;
					dateStr = dueDate.toLocaleDateString('he-IL', { 
						day: 'numeric', 
						month: 'numeric',
						year: 'numeric'
					});
				}
				
				const isSubmitted = assign.submission && assign.submission.status === 'submitted';
				
				let statusClass = '';
				let statusText = '';
				if (isSubmitted) {
					statusClass = 'jct-assignment-submitted';
					statusText = '✓ הוגש';
				} else if (isOverdue) {
					statusClass = 'jct-assignment-overdue';
					statusText = '⚠️ איחור';
				} else if (isUrgent) {
					statusClass = 'jct-assignment-urgent';
					statusText = `⏰ ${daysUntilDue} ימים`;
				} else if (daysUntilDue !== null) {
					statusClass = 'jct-assignment-upcoming';
					statusText = `${daysUntilDue} ימים`;
				} else {
					statusClass = 'jct-assignment-upcoming';
					statusText = 'ללא תאריך';
				}

				const safeName = (assign.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
				
				// Fix URL - ensure it points to assignment view
				let safeUrl = assign.url || '';
				if (safeUrl && !safeUrl.includes('/mod/assign/view.php')) {
					// Try to extract assignment ID from URL
					const urlMatch = safeUrl.match(/[?&]id=(\d+)/);
					if (urlMatch && urlMatch[1]) {
						safeUrl = `${window.location.origin}/mod/assign/view.php?id=${urlMatch[1]}`;
					} else if (assign.id) {
						safeUrl = `${window.location.origin}/mod/assign/view.php?id=${assign.id}`;
					}
				} else if (!safeUrl && assign.id) {
					safeUrl = `${window.location.origin}/mod/assign/view.php?id=${assign.id}`;
				}

				div.className = `jct-assignment-item ${statusClass}`;
				
				const nameDiv = document.createElement('div');
				nameDiv.className = 'jct-assignment-name';
				nameDiv.textContent = safeName;
				
				const metaDiv = document.createElement('div');
				metaDiv.className = 'jct-assignment-meta';
				
				if (dateStr) {
					const dateSpan = document.createElement('span');
					dateSpan.className = 'jct-assignment-date';
					dateSpan.textContent = dateStr;
					metaDiv.appendChild(dateSpan);
				}
				
				const statusSpan = document.createElement('span');
				statusSpan.className = 'jct-assignment-status';
				statusSpan.textContent = statusText;
				metaDiv.appendChild(statusSpan);
				
				div.appendChild(nameDiv);
				div.appendChild(metaDiv);
				
				// Make the entire card clickable, but stop propagation to course card
				div.style.cursor = 'pointer';
				div.addEventListener('click', (e) => {
					// Don't navigate if clicking on buttons
					if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
						return;
					}
					e.stopPropagation();
					e.preventDefault();
					e.stopImmediatePropagation();
					if (safeUrl) {
						window.location.href = safeUrl;
					}
					return false;
				});
				div.addEventListener('mousedown', (e) => {
					e.stopPropagation();
					e.stopImmediatePropagation();
				});
				
				if (safeUrl) {
					const link = document.createElement('a');
					link.href = safeUrl;
					link.className = 'jct-assignment-link';
					link.target = '_blank';
					link.textContent = 'פתח →';
					link.style.cursor = 'pointer';
					link.addEventListener('click', (e) => {
						e.stopPropagation();
						e.preventDefault();
						e.stopImmediatePropagation();
						if (safeUrl) {
							window.location.href = safeUrl;
						}
						return false;
					});
					link.addEventListener('mousedown', (e) => {
						e.stopPropagation();
						e.stopImmediatePropagation();
					});
					div.appendChild(link);
				}
				return div;
			};
			
			// Add carousel functionality
			const toggleBtn = assignmentsContainer.querySelector('.jct-assignments-toggle');
			if (toggleBtn) {
				let currentIndex = 0;
				
				toggleBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					const isExpanded = toggleBtn.getAttribute('data-expanded') === 'true';
					const list = assignmentsContainer.querySelector('.jct-assignments-list');
					
					if (isExpanded) {
						// Collapse - show only urgent
						toggleBtn.setAttribute('data-expanded', 'false');
						toggleBtn.textContent = `הצג הכל (${allActiveAssignmentsRef.length})`;
						list.innerHTML = '';
						assignmentsToShowRef.forEach(assign => {
							list.appendChild(createAssignmentElement(assign, nowRef));
						});
						// Remove carousel controls
						const carouselControls = assignmentsContainer.querySelector('.jct-assignments-carousel-controls');
						if (carouselControls) {
							carouselControls.remove();
						}
						// Show "more" message if it exists
						const moreDiv = assignmentsContainer.querySelector('.jct-assignments-more');
						if (moreDiv) {
							const remainingCount = allActiveAssignmentsRef.length - assignmentsToShowRef.length;
							if (remainingCount > 0) {
								moreDiv.textContent = `+${remainingCount} מטלות נוספות`;
								moreDiv.style.display = 'block';
							} else {
								moreDiv.style.display = 'none';
							}
						}
					} else {
						// Expand - show carousel
						toggleBtn.setAttribute('data-expanded', 'true');
						toggleBtn.textContent = 'הסתר';
						currentIndex = 0;
						
						// Create carousel container
						list.innerHTML = '';
						const carouselWrapper = document.createElement('div');
						carouselWrapper.className = 'jct-assignments-carousel-wrapper';
						
						// Create carousel items container
						const carouselItems = document.createElement('div');
						carouselItems.className = 'jct-assignments-carousel-items';
						
						// Create all assignment elements
						allActiveAssignmentsRef.forEach((assign, index) => {
							const element = createAssignmentElement(assign, nowRef);
							if (element) {
								element.className += ' jct-assignment-carousel-item';
								element.style.display = index === 0 ? 'block' : 'none';
								carouselItems.appendChild(element);
							}
						});
						
						carouselWrapper.appendChild(carouselItems);
						
						// Create carousel controls
						const carouselControls = document.createElement('div');
						carouselControls.className = 'jct-assignments-carousel-controls';
						
						const prevBtn = document.createElement('button');
						prevBtn.className = 'jct-carousel-btn jct-carousel-prev';
						prevBtn.textContent = '←';
						prevBtn.addEventListener('click', (e) => {
							e.stopPropagation();
							e.preventDefault();
							e.stopImmediatePropagation();
							if (currentIndex > 0) {
								currentIndex--;
								updateCarousel();
							}
							return false;
						});
						prevBtn.addEventListener('mousedown', (e) => {
							e.stopPropagation();
							e.stopImmediatePropagation();
						});
						
						const nextBtn = document.createElement('button');
						nextBtn.className = 'jct-carousel-btn jct-carousel-next';
						nextBtn.textContent = '→';
						nextBtn.addEventListener('click', (e) => {
							e.stopPropagation();
							e.preventDefault();
							e.stopImmediatePropagation();
							if (currentIndex < allActiveAssignmentsRef.length - 1) {
								currentIndex++;
								updateCarousel();
							}
							return false;
						});
						nextBtn.addEventListener('mousedown', (e) => {
							e.stopPropagation();
							e.stopImmediatePropagation();
						});
						
						const counter = document.createElement('span');
						counter.className = 'jct-carousel-counter';
						counter.textContent = `1 / ${allActiveAssignmentsRef.length}`;
						
						carouselControls.appendChild(prevBtn);
						carouselControls.appendChild(counter);
						carouselControls.appendChild(nextBtn);
						
						carouselWrapper.appendChild(carouselControls);
						list.appendChild(carouselWrapper);
						
						// Update carousel function
						const updateCarousel = () => {
							const items = carouselItems.querySelectorAll('.jct-assignment-carousel-item');
							items.forEach((item, index) => {
								item.style.display = index === currentIndex ? 'block' : 'none';
							});
							counter.textContent = `${currentIndex + 1} / ${allActiveAssignmentsRef.length}`;
							prevBtn.disabled = currentIndex === 0;
							nextBtn.disabled = currentIndex === allActiveAssignmentsRef.length - 1;
						};
						
						// Initialize
						updateCarousel();
						
						// Hide "more" message
						const moreDiv = assignmentsContainer.querySelector('.jct-assignments-more');
						if (moreDiv) {
							moreDiv.style.display = 'none';
						}
					}
				});
			}
		} catch (error) {
			console.error('Error updating assignments display:', error);
			// Hide container on error
			const assignmentsContainer = card.querySelector('.jct-assignments-container');
			if (assignmentsContainer) {
				assignmentsContainer.innerHTML = '';
				assignmentsContainer.style.display = 'none';
			}
		}
	}

	function ensureStructureAndColor() {
		const cards = document.querySelectorAll('.jct-courses-grid > .list-group-item, .jct-courses-grid .list-group > .list-group-item, .jct-courses-grid .coursebox, .jct-courses-grid .card.course, .jct-courses-grid .course-list > li, .jct-courses-grid > .dashboard-card');
		cards.forEach((card) => {
			// Ensure base positioning for overlays
			if (!card.style.position) card.style.position = 'relative';

			const already = processedCards.has(card);
			let topThumb = card.querySelector('.jct-thumb-wrap');
			if (!topThumb) {
				topThumb = document.createElement('div');
				topThumb.className = 'jct-thumb-wrap';
				card.insertBefore(topThumb, card.firstChild);
			}
			let img = card.querySelector('img.courseimage, .courseimage img, img[src*="pluginfile"], img[src*="/course/overview"]');
			if (img && img.parentElement !== topThumb) {
				topThumb.innerHTML = '';
				topThumb.appendChild(img);
				img.classList.add('jct-thumb-img');
			}
			if (!topThumb.querySelector('img') && !topThumb.querySelector('.jct-course-thumb')) {
				const ph = document.createElement('img');
				ph.className = 'jct-thumb-img';
				ph.alt = '';
				ph.src = getPlaceholderUrl();
				topThumb.appendChild(ph);
			}
			// Always recompute color so palette or detected text changes reflect immediately
			const text = card.innerText || card.textContent || '';
			let { year, semIdx } = parseHebrewYearAndSemester(text);
			if (year == null || semIdx == null) {
				// Fallback: derive stable indices from course id so colors vary and use options palette
				const cid = getCourseIdFromCard(card) || '';
				let hash = 0; for (let i = 0; i < cid.length; i++) { hash = ((hash << 5) - hash) + cid.charCodeAt(i); hash |= 0; }
				const row = Math.abs(hash) % HEBREW_YEARS.length;
				year = HEBREW_YEARS[row];
				const sems = [0,1,2];
				semIdx = sems[Math.abs(hash >> 3) % sems.length];
			}
			const { h, s, l } = colorFor(year, semIdx);
			const styledEl = getStyledCardEl(card);
			styledEl.style.setProperty('--jct-accent-h', String(h));
			styledEl.style.setProperty('--jct-accent-s', String(s) + '%');
			styledEl.style.setProperty('--jct-accent-l', String(l) + '%');
			// Favorite toggle
			let favBtn = card.querySelector('.jct-fav-toggle');
			const courseId = getCourseIdFromCard(card);
			if (!favBtn) {
				favBtn = document.createElement('button');
				favBtn.type = 'button';
				favBtn.className = 'jct-fav-toggle';
				favBtn.title = 'Toggle favorite';
				favBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					const cid = getCourseIdFromCard(card);
					toggleFavorite(cid);
				});
				card.appendChild(favBtn);
			}
			card.setAttribute('data-jct-fav', isFavorite(courseId) ? '1' : '0');
			favBtn.classList.toggle('jct-fav-on', isFavorite(courseId));
			favBtn.setAttribute('aria-pressed', isFavorite(courseId) ? 'true' : 'false');
			favBtn.textContent = isFavorite(courseId) ? '★' : '☆';

			// Schedule button
			let scheduleBtn = card.querySelector('.jct-schedule-btn');
			if (!scheduleBtn) {
				scheduleBtn = document.createElement('button');
				scheduleBtn.type = 'button';
				scheduleBtn.className = 'jct-schedule-btn';
				scheduleBtn.title = 'הוסף ללוח זמנים (לחץ לעריכה, גרור להוספה)';
				scheduleBtn.textContent = '📅';
				scheduleBtn.setAttribute('draggable', 'true');
				scheduleBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					showScheduleDayPicker(courseId, card);
				});
				scheduleBtn.addEventListener('dragstart', (e) => {
					e.stopPropagation();
					const courseName = getCourseNameFromCard(card);
					const courseUrlEl = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a');
					const courseUrl = courseUrlEl ? courseUrlEl.href : '#';
					const data = {
						courseId: courseId,
						courseName: courseName,
						courseUrl: courseUrl
					};
					e.dataTransfer.setData('text/plain', JSON.stringify(data));
					e.dataTransfer.effectAllowed = 'move';
					card.style.opacity = '0.5';
					// Scroll to schedule when starting to drag
					const scheduleContainer = document.getElementById('jct-weekly-schedule');
					if (scheduleContainer) {
						// Make sure schedule is visible
						if (!scheduleViewVisible) {
							scheduleViewVisible = true;
							scheduleContainer.style.display = 'block';
							const toggleBtn = document.getElementById('jct-schedule-toggle');
							if (toggleBtn) {
								toggleBtn.textContent = '✕ סגור לוח זמנים';
							}
							saveScheduleViewState();
						}
						setTimeout(() => {
							scheduleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
						}, 100);
					}
				});
				scheduleBtn.addEventListener('dragend', (e) => {
					card.style.opacity = '1';
				});
				card.appendChild(scheduleBtn);
			}
			
			// Make the card draggable when dragging from schedule button
			// The schedule button itself is draggable, so we don't need to make the whole card draggable
			if (!card.hasAttribute('data-jct-idx')) {
				const parent = card.parentElement;
				if (parent) {
					const idx = Array.prototype.indexOf.call(parent.children, card);
					card.setAttribute('data-jct-idx', String(idx));
				}
			}

			// Add assignments display (async, don't block) - only once per card
			if (courseId && !card.hasAttribute('data-jct-assignments-loaded')) {
				card.setAttribute('data-jct-assignments-loaded', 'true');
				// Delay a bit to avoid blocking initial render
				setTimeout(() => {
					updateAssignmentsDisplay(card, courseId).catch(() => {});
				}, 100);
			}

			// Clickable logic preserved...
			let mainLink = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a');
			if (mainLink && !card.classList.contains('jct-clickable')) {
				card.classList.add('jct-clickable');
				card.style.cursor = 'pointer';
				let isDragging = false;
				let dragStartX = 0;
				let dragStartY = 0;
				
				card.addEventListener('mousedown', (e) => {
					if (e.target.closest('.jct-fav-toggle') || e.target.closest('.jct-schedule-btn')) return;
					dragStartX = e.clientX;
					dragStartY = e.clientY;
					isDragging = false;
				});
				
				card.addEventListener('mousemove', (e) => {
					if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) {
						isDragging = true;
					}
				});
				
				card.addEventListener('click', (event) => {
					if (event.target.closest('.jct-fav-toggle')) return;
					if (event.target.closest('.jct-schedule-btn')) return;
					if (event.target.closest('a[href*="/course/view.php"]')) return;
					if (isDragging) {
						isDragging = false;
						return;
					}
					window.open(mainLink.href, '_self');
				});
			}
			processedCards.add(card);
		});
		// colums amount
		chrome.storage.sync.get({ columnCount: 3 }, ({ columnCount }) => {
		document.documentElement.style.setProperty('--jct-columns', columnCount);
});


		// After ensuring cards, reorder each grid container in a guarded way
		isReordering = true;
		try { document.querySelectorAll('.jct-courses-grid').forEach(reorderContainerByFavorites); }
		finally { isReordering = false; }
	}

	function markCoursesContainers() {
		const selectors = [
			'.block_myoverview .courses-view',
			'.block_myoverview .list-group',
			'.block_myoverview [data-region="courses-view"] .list-group',
			'.block_myoverview .content .list-group',
			'.dashboard-card-deck',
			'#frontpage-course-list .courses',
			'#frontpage-course-list .course-list',
			'.course_category_tree .courses',
			'.course_category_tree .category-browse .courses'
		];
		const containers = document.querySelectorAll(selectors.join(','));
		containers.forEach((el) => {
			if (!el.classList.contains('jct-courses-grid')) {
				el.classList.add('jct-courses-grid');
			}
		});
	}

	function reorderContainerByFavorites(container) {
		if (!container) return;
		const children = Array.from(container.children);
		// Determine favorites and keep stable order by original index
		const withMeta = children.map((el, i) => {
			const card = el;
			const idx = Number(card.getAttribute('data-jct-idx') || i);
			const cid = getCourseIdFromCard(card) || getCourseIdFromCard(card.querySelector('.list-group-item, .coursebox, .card.course, li') || card);
			const fav = isFavorite(cid) || card.getAttribute('data-jct-fav') === '1';
			return { card, fav, idx };
		});
		const sorted = withMeta.slice().sort((a, b) => {
			if (a.fav !== b.fav) return a.fav ? -1 : 1;
			return a.idx - b.idx;
		});
		let changed = false;
		sorted.forEach(({ card }, pos) => {
			if (container.children[pos] !== card) { changed = true; container.appendChild(card); }
		});
		if (changed) {
			// Update indices
			Array.from(container.children).forEach((c, i) => c.setAttribute('data-jct-idx', String(i)));
		}
	}

	function getPlaceholderUrl() { return chrome.runtime.getURL('assets/placeholder.svg'); }

	function relocateTopBlocksAfterCourses() {
		const body = document.body;
		if (!body || body.id !== 'page-site-index') return;
		const region = document.getElementById('region-main') || document.querySelector('#region-main, main');
		if (!region) return;
		const coursesGrid = region.querySelector('.jct-courses-grid');
		const coursesAnchor = coursesGrid ? (coursesGrid.closest('.block, .box, .card, section, .content, div') || coursesGrid) : null;
		if (!coursesAnchor) return;
		const candidates = new Set();
		region.querySelectorAll('.course-content .sitetopic').forEach((el) => candidates.add(el.closest('.card, .box, section, .content, div') || el));
		region.querySelectorAll('.box .simplesearchform, .simplesearchform').forEach((el) => candidates.add(el.closest('.box, .card, .content, form, div') || el));
		region.querySelectorAll('form.coursesearch, .coursesearchbox, [role="search"]').forEach((el) => candidates.add(el.closest('.card, .box, .content, form') || el));
		let hero = null; let maxArea = 0;
		region.querySelectorAll('img').forEach((img) => {
			const w = img.naturalWidth || img.width || 0;
			const h = img.naturalHeight || img.height || 0;
			const area = w * h;
			if (area > maxArea && (w >= 600 || h >= 180)) { hero = img; maxArea = area; }
		});
		if (hero) candidates.add(hero.closest('.card, .box, section, .content, div') || hero);
		Array.from(candidates).forEach((el) => {
			if (!el || el.classList.contains('jct-moved-bottom')) return;
			region.appendChild(el);
			el.classList.add('jct-moved-bottom');
		});
	}

	const DAYS_OF_WEEK = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
	const DAYS_OF_WEEK_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

	function showScheduleDayPicker(courseId, card) {
		const courseName = getCourseNameFromCard(card);
		const courseUrl = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a')?.href || '#';
		const currentSchedule = courseSchedules[courseId] || { name: courseName, days: [] };
		
		// Create modal
		const modal = document.createElement('div');
		modal.className = 'jct-schedule-modal';
		modal.innerHTML = `
			<div class="jct-schedule-modal-content">
				<div class="jct-schedule-modal-header">
					<h3>בחר ימים עבור: ${courseName}</h3>
					<button class="jct-schedule-modal-close">✕</button>
				</div>
				<div class="jct-schedule-modal-body">
					${DAYS_OF_WEEK.map((day, idx) => {
						const dayKey = DAYS_OF_WEEK_EN[idx];
						const checked = currentSchedule.days.includes(dayKey) ? 'checked' : '';
						return `<label class="jct-schedule-day-checkbox">
							<input type="checkbox" data-day="${dayKey}" ${checked}>
							<span>${day}</span>
						</label>`;
					}).join('')}
				</div>
				<div class="jct-schedule-modal-footer">
					<button class="jct-schedule-modal-save">שמור</button>
					<button class="jct-schedule-modal-remove">הסר מלוח זמנים</button>
					<button class="jct-schedule-modal-delete-all">מחק לחלוטין</button>
				</div>
			</div>
		`;
		
		document.body.appendChild(modal);
		
		// Event listeners
		modal.querySelector('.jct-schedule-modal-close').addEventListener('click', () => {
			modal.remove();
		});
		
		modal.querySelector('.jct-schedule-modal-save').addEventListener('click', async () => {
			const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
			const selectedDays = Array.from(checkboxes)
				.filter(cb => cb.checked)
				.map(cb => cb.getAttribute('data-day'));
			
			if (selectedDays.length > 0) {
				courseSchedules[courseId] = { name: courseName, days: selectedDays, url: courseUrl };
			} else {
				delete courseSchedules[courseId];
			}
			
			try {
				await saveCourseSchedules();
				setTimeout(() => {
					updateWeeklyScheduleView();
					modal.remove();
				}, 300);
			} catch (err) {
				console.error('Error saving course schedule:', err);
				alert('שגיאה בשמירת הלוח זמנים. נסה שוב.');
				modal.remove();
			}
		});
		
		modal.querySelector('.jct-schedule-modal-remove').addEventListener('click', async () => {
			delete courseSchedules[courseId];
			try {
				await saveCourseSchedules();
				setTimeout(() => {
					updateWeeklyScheduleView();
					modal.remove();
				}, 300);
			} catch (err) {
				console.error('Error removing course:', err);
				modal.remove();
			}
		});
		
		const deleteAllBtn = modal.querySelector('.jct-schedule-modal-delete-all');
		if (deleteAllBtn) {
			deleteAllBtn.addEventListener('click', async () => {
				if (confirm('האם אתה בטוח שברצונך למחוק את הקורס לחלוטין מכל הימים?')) {
					delete courseSchedules[courseId];
					try {
						await saveCourseSchedules();
						setTimeout(() => {
							updateWeeklyScheduleView();
							modal.remove();
						}, 300);
					} catch (err) {
						console.error('Error deleting course:', err);
						modal.remove();
					}
				}
			});
		}
		
		modal.addEventListener('click', (e) => {
			if (e.target === modal) modal.remove();
		});
	}

	function saveCourseSchedules() {
		return new Promise((resolve) => {
			// Clear any pending saves
			if (saveSchedulesTimeout) {
				clearTimeout(saveSchedulesTimeout);
			}
			
			// If already saving, wait a bit
			if (isSavingSchedules) {
				saveSchedulesTimeout = setTimeout(() => {
					saveCourseSchedules().then(resolve);
				}, 200);
				return;
			}
			
			isSavingSchedules = true;
			
			try {
				const schedulesToSave = JSON.parse(JSON.stringify(courseSchedules));
				chrome.storage.local.set({ courseSchedules: schedulesToSave }, () => {
					isSavingSchedules = false;
					if (chrome.runtime.lastError) {
						console.error('Error saving schedules:', chrome.runtime.lastError);
						// Try sync as fallback
						try {
							chrome.storage.sync.set({ courseSchedules: schedulesToSave }, () => {
								resolve();
							});
						} catch (e) {
							resolve();
						}
					} else {
						resolve();
					}
				});
			} catch (e) {
				console.error('Error in saveCourseSchedules:', e);
				isSavingSchedules = false;
				resolve();
			}
		});
	}

	function createWeeklyScheduleView() {
		// Check if schedule view already exists
		let scheduleContainer = document.getElementById('jct-weekly-schedule');
		if (scheduleContainer) {
			updateWeeklyScheduleView();
			return scheduleContainer;
		}

		const region = document.getElementById('region-main') || document.querySelector('#region-main, main');
		if (!region) return null;

		// Create toggle button
		const toggleBtn = document.createElement('button');
		toggleBtn.id = 'jct-schedule-toggle';
		toggleBtn.className = 'jct-schedule-toggle';
		toggleBtn.textContent = scheduleViewVisible ? '✕ סגור לוח זמנים' : '📅 הצג לוח זמנים שבועי';
		toggleBtn.addEventListener('click', () => {
			scheduleViewVisible = !scheduleViewVisible;
			const container = document.getElementById('jct-weekly-schedule');
			if (container) {
				container.style.display = scheduleViewVisible ? 'block' : 'none';
				toggleBtn.textContent = scheduleViewVisible ? '✕ סגור לוח זמנים' : '📅 הצג לוח זמנים שבועי';
				saveScheduleViewState();
				// Scroll to schedule if opening
				if (scheduleViewVisible) {
					setTimeout(() => {
						container.scrollIntoView({ behavior: 'smooth', block: 'start' });
					}, 100);
				}
			}
		});

		// Create schedule container
		scheduleContainer = document.createElement('div');
		scheduleContainer.id = 'jct-weekly-schedule';
		scheduleContainer.className = 'jct-weekly-schedule';
		scheduleContainer.style.display = scheduleViewVisible ? 'block' : 'none';

		// Insert before courses grid
		const coursesGrid = region.querySelector('.jct-courses-grid');
		if (coursesGrid && coursesGrid.parentElement) {
			coursesGrid.parentElement.insertBefore(toggleBtn, coursesGrid);
			coursesGrid.parentElement.insertBefore(scheduleContainer, coursesGrid);
		} else {
			region.insertBefore(toggleBtn, region.firstChild);
			region.insertBefore(scheduleContainer, region.firstChild);
		}

		updateWeeklyScheduleView();
		return scheduleContainer;
	}

	function updateWeeklyScheduleView() {
		const scheduleContainer = document.getElementById('jct-weekly-schedule');
		if (!scheduleContainer) {
			console.log('Schedule container not found, creating it...');
			createWeeklyScheduleView();
			return;
		}

		// Group courses by day from courseSchedules
		const coursesByDay = {};
		DAYS_OF_WEEK_EN.forEach(day => { coursesByDay[day] = []; });

		Object.keys(courseSchedules).forEach(courseId => {
			const schedule = courseSchedules[courseId];
			if (!schedule || !schedule.days || schedule.days.length === 0) return;

			schedule.days.forEach(day => {
				if (coursesByDay[day]) {
					coursesByDay[day].push({
						id: courseId,
						name: schedule.name || `קורס ${courseId}`,
						url: schedule.url || '#'
					});
				}
			});
		});

		// Build HTML
		let html = '<div class="jct-schedule-header"><h2>לוח זמנים שבועי</h2><p class="jct-schedule-hint">גרור 📅 לימים או לחץ עליו לעריכה  </p>';
		html += '<button class="jct-schedule-delete-all-btn" title="מחק את כל הקורסים מהלוח זמנים">🗑️ מחק הכל</button></div>';
		html += '<div class="jct-schedule-grid">';
		
		DAYS_OF_WEEK.forEach((dayName, idx) => {
			const dayKey = DAYS_OF_WEEK_EN[idx];
			const courses = coursesByDay[dayKey] || [];
			
			html += `<div class="jct-schedule-day" data-day="${dayKey}">
				<div class="jct-schedule-day-header">${dayName}</div>
				<div class="jct-schedule-day-courses" data-day="${dayKey}">`;
			
			if (courses.length === 0) {
				html += '<div class="jct-schedule-empty">גרור קורס לכאן</div>';
			} else {
				courses.forEach(course => {
					html += `<div class="jct-schedule-course-item" data-course-id="${course.id}" draggable="true">
						<a href="${course.url}" class="jct-schedule-course-link">${course.name}</a>
						<button class="jct-schedule-remove-course" data-course-id="${course.id}" data-day="${dayKey}" title="הסר מיום זה">✕</button>
					</div>`;
				});
			}
			
			html += '</div></div>';
		});
		
		html += '</div>';
		scheduleContainer.innerHTML = html;
		
		// Setup delete all button - use event delegation on document to ensure it always works
		// Remove old listener if exists
		if (scheduleContainer._deleteAllHandler) {
			document.removeEventListener('click', scheduleContainer._deleteAllHandler);
		}
		
		// Create new handler
		scheduleContainer._deleteAllHandler = async (e) => {
			const deleteBtn = e.target.closest('.jct-schedule-delete-all-btn');
			if (deleteBtn) {
				e.preventDefault();
				e.stopPropagation();
				console.log('Delete all button clicked');
				const hasCourses = Object.keys(courseSchedules).length > 0;
				if (!hasCourses) {
					alert('אין קורסים במערכת למחיקה');
					return;
				}
				
				if (confirm('⚠️ האם אתה בטוח שברצונך למחוק את כל הקורסים מהלוח זמנים?\n\nפעולה זו לא ניתנת לביטול!')) {
					if (confirm('האם אתה בטוח לחלוטין? כל הקורסים יימחקו מהלוח זמנים.')) {
						courseSchedules = {};
						try {
							await saveCourseSchedules();
							// Use setTimeout to avoid race conditions
							setTimeout(() => {
								updateWeeklyScheduleView();
								alert('כל הקורסים נמחקו מהלוח זמנים');
							}, 300);
						} catch (err) {
							console.error('Error deleting all courses:', err);
							alert('שגיאה במחיקת הקורסים. נסה שוב.');
						}
					}
				}
			}
		};
		
		// Use event delegation on document - this way it always works even if HTML is replaced
		document.addEventListener('click', scheduleContainer._deleteAllHandler);

		// Setup drag and drop
		setupScheduleDragAndDrop();
		
		// Make sure the container visibility matches saved state
		const toggleBtn = document.getElementById('jct-schedule-toggle');
		if (toggleBtn) {
			scheduleContainer.style.display = scheduleViewVisible ? 'block' : 'none';
			toggleBtn.textContent = scheduleViewVisible ? '✕ סגור לוח זמנים' : '📅 הצג לוח זמנים שבועי';
		}
	}

	function setupScheduleDragAndDrop() {
		// Remove old listeners by using a unique class or data attribute
		const dayColumns = document.querySelectorAll('.jct-schedule-day-courses');
		
		// Remove all old event listeners by cloning
		dayColumns.forEach(column => {
			// Clone to remove old listeners
			const newColumn = column.cloneNode(true);
			column.parentNode.replaceChild(newColumn, column);
		});
		
		// Now setup new listeners
		const newDayColumns = document.querySelectorAll('.jct-schedule-day-courses');
		newDayColumns.forEach(column => {
			// Allow dropping
			column.addEventListener('dragenter', (e) => {
				e.preventDefault();
				column.classList.add('jct-schedule-drag-over');
				// Scroll to top when dragging over
				const scheduleContainer = document.getElementById('jct-weekly-schedule');
				if (scheduleContainer) {
					scheduleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}
			});
			
			column.addEventListener('dragover', (e) => {
				e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
				column.classList.add('jct-schedule-drag-over');
			});
			
			column.addEventListener('dragleave', (e) => {
				// Only remove if we're actually leaving the column
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
					if (!dataStr || dataStr === 'null') {
						console.log('No data in drop event');
						return;
					}
					
					const data = JSON.parse(dataStr);
					const dayKey = column.getAttribute('data-day');
					
					if (data.courseId && dayKey) {
						// If moving from schedule, remove from old day first
						if (data.fromSchedule) {
							const oldItem = document.querySelector(`.jct-schedule-course-item[data-course-id="${data.courseId}"]`);
							if (oldItem) {
								const oldDayKey = oldItem.closest('.jct-schedule-day-courses')?.getAttribute('data-day');
								if (oldDayKey && oldDayKey !== dayKey && courseSchedules[data.courseId]) {
									courseSchedules[data.courseId].days = courseSchedules[data.courseId].days.filter(d => d !== oldDayKey);
								}
							}
						}
						
						// Add course to this day
						if (!courseSchedules[data.courseId]) {
							courseSchedules[data.courseId] = {
								name: data.courseName || `קורס ${data.courseId}`,
								days: [],
								url: data.courseUrl || '#'
							};
						}
						
						if (!courseSchedules[data.courseId].days.includes(dayKey)) {
							courseSchedules[data.courseId].days.push(dayKey);
							try {
								await saveCourseSchedules();
								setTimeout(() => updateWeeklyScheduleView(), 300);
							} catch (err) {
								console.error('Error adding course to day:', err);
							}
						}
					}
				} catch (err) {
					console.error('Error handling drop:', err, e.dataTransfer.getData('text/plain'));
				}
			});
		});

		// Make course items in schedule draggable - use event delegation for click handlers
		// Setup click handler on document for course items
		if (!document._scheduleCourseClickHandler) {
			document._scheduleCourseClickHandler = (e) => {
				const courseItem = e.target.closest('.jct-schedule-course-item');
				if (!courseItem) return;
				
				// Don't navigate if clicking on remove button
				if (e.target.closest('.jct-schedule-remove-course')) {
					return;
				}
				
				const link = courseItem.querySelector('a.jct-schedule-course-link');
				if (link && link.href && link.href !== '#') {
					// Don't navigate if item is semi-transparent (being dragged)
					if (courseItem.style.opacity === '0.5') {
						return;
					}
					// Navigate to course
					e.preventDefault();
					e.stopPropagation();
					window.location.href = link.href;
				}
			};
			document.addEventListener('click', document._scheduleCourseClickHandler, true);
		}
		
		// Make course items draggable
		const courseItems = document.querySelectorAll('.jct-schedule-course-item');
		courseItems.forEach(item => {
			item.addEventListener('dragstart', (e) => {
				// Don't drag if clicking on remove button
				if (e.target.closest('.jct-schedule-remove-course')) {
					e.preventDefault();
					return;
				}
				// Don't drag if clicking directly on link
				if (e.target.tagName === 'A' || e.target.closest('a')) {
					e.preventDefault();
					return;
				}
				const courseId = item.getAttribute('data-course-id');
				const course = courseSchedules[courseId];
				if (course) {
					e.dataTransfer.setData('text/plain', JSON.stringify({
						courseId: courseId,
						courseName: course.name,
						courseUrl: course.url,
						fromSchedule: true
					}));
					e.dataTransfer.effectAllowed = 'move';
					item.style.opacity = '0.5';
					// Scroll to top when starting to drag
					const scheduleContainer = document.getElementById('jct-weekly-schedule');
					if (scheduleContainer) {
						scheduleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
					}
				}
			});
			
			item.addEventListener('dragend', (e) => {
				item.style.opacity = '1';
			});

			// Remove button - remove from specific day
			const removeBtn = item.querySelector('.jct-schedule-remove-course');
			if (removeBtn) {
				// Get dayKey from button's data attribute or parent
				const dayKey = removeBtn.getAttribute('data-day') || item.closest('.jct-schedule-day-courses')?.getAttribute('data-day');
				if (dayKey) {
					removeBtn.setAttribute('data-day', dayKey);
				}
				
				removeBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					e.preventDefault();
					const courseId = removeBtn.getAttribute('data-course-id');
					const dayKeyFromBtn = removeBtn.getAttribute('data-day') || item.closest('.jct-schedule-day-courses')?.getAttribute('data-day');
					
					if (courseId && dayKeyFromBtn && courseSchedules[courseId]) {
						courseSchedules[courseId].days = courseSchedules[courseId].days.filter(d => d !== dayKeyFromBtn);
						if (courseSchedules[courseId].days.length === 0) {
							delete courseSchedules[courseId];
						}
						try {
							await saveCourseSchedules();
							setTimeout(() => updateWeeklyScheduleView(), 300);
						} catch (err) {
							console.error('Error removing course:', err);
						}
					}
				});
			}
			
			// Style item as clickable - click handling is done via event delegation above
			const link = item.querySelector('a.jct-schedule-course-link');
			if (link && link.href && link.href !== '#') {
				item.style.cursor = 'pointer';
				link.style.cursor = 'pointer';
			}
		});
		
		// The drop handler above already handles both new courses and moving between days
	}

	function hideFrontClutter() {
		// Remove the empty box div
		const emptyBox = document.querySelector('.box.py-3.d-flex.justify-content-center');
		if (emptyBox && emptyBox.children.length === 0) {
			emptyBox.remove();
		}
		// Also try with just the classes
		document.querySelectorAll('.box.py-3').forEach(box => {
			if (box.classList.contains('d-flex') && box.classList.contains('justify-content-center') && box.children.length === 0) {
				box.remove();
			}
		});
	}

	// Add settings button to page
	function addSettingsButton() {
		// Check if button already exists
		if (document.getElementById('jct-settings-button')) {
			return;
		}
		
		// Find the main page header with title
		const pageHeader = document.querySelector('#page-header, .page-header');
		const pageTitleContainer = document.querySelector('.page-header-headings, .page-context-header, #page-header .card-body, .page-header-content');
		
		const settingsBtn = document.createElement('button');
		settingsBtn.id = 'jct-settings-button';
		settingsBtn.className = 'jct-settings-button';
		settingsBtn.innerHTML = '⚙️ אפשרויות';
		settingsBtn.title = 'פתח את אפשרויות התוסף';
		
		settingsBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			// Try to open options page via background script
			chrome.runtime.sendMessage({action: 'openOptions'}, (response) => {
				if (chrome.runtime.lastError) {
					// Fallback: try direct method
					try {
						chrome.runtime.openOptionsPage();
					} catch (err) {
						console.error('Failed to open options:', err);
					}
				}
			});
		});
		
		// Add to page header on the LEFT side (in RTL this is visually on the RIGHT side of screen)
		if (pageTitleContainer) {
			// Add at the END of the title container (will be on the left/right side in RTL)
			pageTitleContainer.appendChild(settingsBtn);
		} else if (mainTitle && mainTitle.parentElement) {
			// Add after the title
			if (mainTitle.nextSibling) {
				mainTitle.parentElement.insertBefore(settingsBtn, mainTitle.nextSibling);
			} else {
				mainTitle.parentElement.appendChild(settingsBtn);
			}
		} else if (pageHeader) {
			// Add to page header at the end
			pageHeader.appendChild(settingsBtn);
		} else {
			// Fallback: fixed position top left (right in RTL)
			settingsBtn.style.position = 'fixed';
			settingsBtn.style.top = '20px';
			settingsBtn.style.left = '20px';
			settingsBtn.style.zIndex = '10000';
			document.body.appendChild(settingsBtn);
		}
	}

	docReady(async () => {
		document.documentElement.classList.add('jct-moodle-redesign');
		const html = document.documentElement;
		if (html.dir === 'rtl') html.classList.add('jct-rtl');
		await Promise.all([loadPaletteHeb(), loadFavorites(), loadCourseSchedules(), loadCourseAssignments()]);
		markCoursesContainers();
		ensureStructureAndColor();
		relocateTopBlocksAfterCourses();
		hideFrontClutter();
		createWeeklyScheduleView();
		addSettingsButton();
	const obs = new MutationObserver(() => { scheduleLightUpdate(); });
		obs.observe(document.body, { childList: true, subtree: true });
		if (chrome?.storage?.onChanged) {
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area === 'sync' && changes.paletteByYearHeb) {
					paletteByYearHeb = changes.paletteByYearHeb.newValue;
					ensureStructureAndColor();
				}
				if (area === 'sync' && changes.favoriteCourseIds) {
					const arr = Array.isArray(changes.favoriteCourseIds.newValue) ? changes.favoriteCourseIds.newValue : [];
					favoriteCourseIds = new Set(arr.map(String));
					refreshFavoritesUI();
				}
				if (area === 'sync' && changes.courseSchedules) {
					courseSchedules = changes.courseSchedules.newValue || {};
					updateWeeklyScheduleView();
				}
			});
		}
	});
})();
