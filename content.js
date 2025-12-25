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
	let currentViewMode = 'grid'; // Default view mode
	let currentCardStyle = 'compact'; // Default card style

	// Function to apply card style
	function applyCardStyle(style) {
		currentCardStyle = style;

		// Remove all style classes
		document.body.classList.remove('jct-style-compact', 'jct-style-minimal', 'jct-style-cards', 'jct-style-modern');

		// Add the selected style class
		document.body.classList.add(`jct-style-${style}`);
	}

	// Function to apply view mode
	function applyViewMode(mode) {
		currentViewMode = mode;

		// Apply to all possible course containers
		const containers = document.querySelectorAll('.jct-courses-grid');
		containers.forEach(coursesContainer => {
			const parentContainer = coursesContainer.closest('.course-content, #frontpage-course-list, .courses') || coursesContainer.parentElement;
			if (parentContainer) {
				if (mode === 'list') {
					parentContainer.classList.add('jct-courses-list-view');
				} else {
					parentContainer.classList.remove('jct-courses-list-view');
				}
			}
		});

		// Also apply to body for global scope
		if (mode === 'list') {
			document.body.classList.add('jct-courses-list-view');
		} else {
			document.body.classList.remove('jct-courses-list-view');
		}
	}
	let isSavingSchedules = false;

	function scheduleLightUpdate() {
		if (scheduled || isReordering) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			markCoursesContainers();
			ensureStructureAndColor();
			refreshFavoritesUI();
			applyViewMode(currentViewMode);
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

	function loadViewMode() {
		return new Promise((resolve) => {
			try {
				chrome.storage.sync.get({ viewMode: 'grid', cardStyle: 'compact' }, (res) => {
					currentViewMode = res.viewMode || 'grid';
					currentCardStyle = res.cardStyle || 'compact';
					applyViewMode(currentViewMode);
					applyCardStyle(currentCardStyle);
					resolve({ viewMode: currentViewMode, cardStyle: currentCardStyle });
				});
			} catch (_e) { resolve({ viewMode: 'grid', cardStyle: 'compact' }); }
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

			// Migrate from days array to sessions array
			if (courseSchedules[courseId].days && !courseSchedules[courseId].sessions) {
				const days = courseSchedules[courseId].days.filter(day => day !== 'saturday');
				courseSchedules[courseId].sessions = days.map(day => ({
					day: day,
					startTime: '',
					endTime: ''
				}));
				delete courseSchedules[courseId].days;
			}

			// Remove saturday from sessions
			if (courseSchedules[courseId].sessions) {
				courseSchedules[courseId].sessions = courseSchedules[courseId].sessions.filter(
					session => session.day !== 'saturday'
				);
				// Remove course if no sessions left
				if (courseSchedules[courseId].sessions.length === 0) {
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

			// Assignments feature disabled
			// if (courseId && !card.hasAttribute('data-jct-assignments-loaded')) {
			// 	card.setAttribute('data-jct-assignments-loaded', 'true');
			// 	setTimeout(() => {
			// 		updateAssignmentsDisplay(card, courseId).catch(() => {});
			// 	}, 100);
			// }

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
		const currentSchedule = courseSchedules[courseId] || { name: courseName, sessions: [], url: courseUrl };

		// Create modal
		const modal = document.createElement('div');
		modal.className = 'jct-schedule-modal';

		function renderSessions() {
			const sessions = currentSchedule.sessions || [];
			const sessionsHtml = sessions.map((session, idx) => {
				return `
					<div class="jct-session-item" data-session-idx="${idx}">
						<select class="jct-session-day">
							${DAYS_OF_WEEK.map((day, i) => {
								const selected = DAYS_OF_WEEK_EN[i] === session.day ? 'selected' : '';
								return `<option value="${DAYS_OF_WEEK_EN[i]}" ${selected}>${day}</option>`;
							}).join('')}
						</select>
						<input type="time" class="jct-session-time" value="${session.startTime || ''}" placeholder="התחלה">
						<span>-</span>
						<input type="time" class="jct-session-time" value="${session.endTime || ''}" placeholder="סיום">
						<button class="jct-remove-session" data-idx="${idx}">🗑️</button>
					</div>
				`;
			}).join('');

			return `
				<div class="jct-schedule-modal-content">
					<div class="jct-schedule-modal-header">
						<h3>מערכת שעות עבור: ${courseName}</h3>
						<button class="jct-schedule-modal-close">✕</button>
					</div>
					<div class="jct-schedule-modal-body">
						<div class="jct-sessions-container">
							${sessionsHtml}
						</div>
						<button class="jct-add-session">+ הוסף מופע</button>
					</div>
					<div class="jct-schedule-modal-footer">
						<button class="jct-schedule-modal-save">שמור</button>
						<button class="jct-schedule-modal-remove">הסר מלוח זמנים</button>
					</div>
				</div>
			`;
		}

		modal.innerHTML = renderSessions();
		document.body.appendChild(modal);
		
		// Event listeners
		modal.querySelector('.jct-schedule-modal-close').addEventListener('click', () => {
			modal.remove();
		});

		// Add session button
		modal.querySelector('.jct-add-session').addEventListener('click', () => {
			currentSchedule.sessions.push({
				day: 'sunday',
				startTime: '',
				endTime: ''
			});
			modal.innerHTML = renderSessions();
			attachSessionListeners();
		});

		function attachSessionListeners() {
			// Remove session buttons
			modal.querySelectorAll('.jct-remove-session').forEach(btn => {
				btn.addEventListener('click', () => {
					const idx = parseInt(btn.getAttribute('data-idx'));
					currentSchedule.sessions.splice(idx, 1);
					modal.innerHTML = renderSessions();
					attachSessionListeners();
				});
			});

			// Update session data on change
			modal.querySelectorAll('.jct-session-item').forEach((item, idx) => {
				const daySelect = item.querySelector('.jct-session-day');
				const timeInputs = item.querySelectorAll('.jct-session-time');

				daySelect.addEventListener('change', () => {
					currentSchedule.sessions[idx].day = daySelect.value;
				});

				timeInputs[0].addEventListener('change', () => {
					currentSchedule.sessions[idx].startTime = timeInputs[0].value;
				});

				timeInputs[1].addEventListener('change', () => {
					currentSchedule.sessions[idx].endTime = timeInputs[1].value;
				});
			});

			// Re-attach other buttons
			modal.querySelector('.jct-add-session')?.addEventListener('click', () => {
				currentSchedule.sessions.push({
					day: 'sunday',
					startTime: '',
					endTime: ''
				});
				modal.innerHTML = renderSessions();
				attachSessionListeners();
			});

			modal.querySelector('.jct-schedule-modal-save')?.addEventListener('click', async () => {
				if (currentSchedule.sessions.length > 0) {
					courseSchedules[courseId] = {
						name: courseName,
						sessions: currentSchedule.sessions,
						url: courseUrl
					};
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

			modal.querySelector('.jct-schedule-modal-remove')?.addEventListener('click', async () => {
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

			modal.querySelector('.jct-schedule-modal-close')?.addEventListener('click', () => {
				modal.remove();
			});
		}

		attachSessionListeners();

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

		// Group sessions by day from courseSchedules
		const sessionsByDay = {};
		DAYS_OF_WEEK_EN.forEach(day => { sessionsByDay[day] = []; });

		Object.keys(courseSchedules).forEach(courseId => {
			const schedule = courseSchedules[courseId];
			if (!schedule || !schedule.sessions || schedule.sessions.length === 0) return;

			schedule.sessions.forEach(session => {
				if (sessionsByDay[session.day]) {
					sessionsByDay[session.day].push({
						id: courseId,
						name: schedule.name || `קורס ${courseId}`,
						url: schedule.url || '#',
						startTime: session.startTime || '',
						endTime: session.endTime || '',
						session: session
					});
				}
			});
		});

		// Sort sessions by start time
		Object.keys(sessionsByDay).forEach(day => {
			sessionsByDay[day].sort((a, b) => {
				if (!a.startTime) return 1;
				if (!b.startTime) return -1;
				return a.startTime.localeCompare(b.startTime);
			});
		});

		// Build HTML
		let html = '<div class="jct-schedule-header"><h2>לוח זמנים שבועי</h2><p class="jct-schedule-hint">גרור 📅 קורסים לימים או לחץ על ✏️ לעריכה</p>';
		html += '<button class="jct-schedule-delete-all-btn" title="מחק את כל הקורסים מהלוח זמנים">🗑️ מחק הכל</button></div>';
		html += '<div class="jct-schedule-grid">';

		DAYS_OF_WEEK.forEach((dayName, idx) => {
			const dayKey = DAYS_OF_WEEK_EN[idx];
			const sessions = sessionsByDay[dayKey] || [];

			html += `<div class="jct-schedule-day" data-day="${dayKey}">
				<div class="jct-schedule-day-header">${dayName}</div>
				<div class="jct-schedule-day-courses" data-day="${dayKey}">`;

			if (sessions.length === 0) {
				html += '<div class="jct-schedule-empty">אין שיעורים</div>';
			} else {
				sessions.forEach(sessionData => {
					const timeDisplay = sessionData.startTime && sessionData.endTime
						? `<div class="jct-session-time">${sessionData.startTime} - ${sessionData.endTime}</div>`
						: '';
					html += `<div class="jct-schedule-course-item" data-course-id="${sessionData.id}">
						<div class="jct-session-content">
							<a href="${sessionData.url}" class="jct-schedule-course-link">${sessionData.name}</a>
							${timeDisplay}
						</div>
						<button class="jct-schedule-edit-course" data-course-id="${sessionData.id}" title="ערוך מערכת">✏️</button>
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

	function showTimePickerDialog(courseName) {
		return new Promise((resolve) => {
			const dialog = document.createElement('div');
			dialog.className = 'jct-time-picker-dialog';
			dialog.innerHTML = `
				<div class="jct-time-picker-content">
					<div class="jct-time-picker-header">
						<h3>בחר שעות עבור: ${courseName}</h3>
						<button class="jct-time-picker-close">✕</button>
					</div>
					<div class="jct-time-picker-body">
						<label>
							<span>שעת התחלה:</span>
							<input type="time" class="jct-time-start" placeholder="08:00">
						</label>
						<label>
							<span>שעת סיום:</span>
							<input type="time" class="jct-time-end" placeholder="10:00">
						</label>
					</div>
					<div class="jct-time-picker-footer">
						<button class="jct-time-picker-save">שמור</button>
						<button class="jct-time-picker-skip">דלג (ללא שעות)</button>
					</div>
				</div>
			`;

			document.body.appendChild(dialog);

			const closeDialog = () => {
				dialog.remove();
			};

			dialog.querySelector('.jct-time-picker-close').addEventListener('click', () => {
				closeDialog();
				resolve(null);
			});

			dialog.querySelector('.jct-time-picker-skip').addEventListener('click', () => {
				closeDialog();
				resolve({ startTime: '', endTime: '' });
			});

			dialog.querySelector('.jct-time-picker-save').addEventListener('click', () => {
				const startTime = dialog.querySelector('.jct-time-start').value;
				const endTime = dialog.querySelector('.jct-time-end').value;
				closeDialog();
				resolve({ startTime, endTime });
			});

			dialog.addEventListener('click', (e) => {
				if (e.target === dialog) {
					closeDialog();
					resolve(null);
				}
			});
		});
	}

	function setupScheduleDragAndDrop() {
		// Setup click handler for edit buttons using event delegation
		// Remove old handler if exists
		if (document._scheduleEditClickHandler) {
			document.removeEventListener('click', document._scheduleEditClickHandler, true);
		}

		document._scheduleEditClickHandler = (e) => {
			const editBtn = e.target.closest('.jct-schedule-edit-course');
			if (!editBtn) return;

			e.preventDefault();
			e.stopPropagation();

			const courseId = editBtn.getAttribute('data-course-id');
			if (!courseId) return;

			// Find the course card to pass to the picker
			const courseCards = document.querySelectorAll('.jct-course-card');
			let courseCard = null;
			courseCards.forEach(card => {
				const cardId = card.getAttribute('data-course-id');
				if (cardId === courseId) {
					courseCard = card;
				}
			});

			// If card not found, create a dummy one
			if (!courseCard) {
				const schedule = courseSchedules[courseId];
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
		};
		document.addEventListener('click', document._scheduleEditClickHandler, true);

		// Setup drag & drop for day columns
		const dayColumns = document.querySelectorAll('.jct-schedule-day-courses');
		dayColumns.forEach(column => {
			column.addEventListener('dragenter', (e) => {
				e.preventDefault();
				column.classList.add('jct-schedule-drag-over');
			});

			column.addEventListener('dragover', (e) => {
				e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
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

					// Ask for time
					const timeData = await showTimePickerDialog(
						data.courseName || `קורס ${data.courseId}`
					);

					if (timeData === null) return; // User cancelled

					// Add session
					if (!courseSchedules[data.courseId]) {
						courseSchedules[data.courseId] = {
							name: data.courseName || `קורס ${data.courseId}`,
							sessions: [],
							url: data.courseUrl || '#'
						};
					}

					courseSchedules[data.courseId].sessions.push({
						day: dayKey,
						startTime: timeData.startTime || '',
						endTime: timeData.endTime || ''
					});

					await saveCourseSchedules();
					setTimeout(() => updateWeeklyScheduleView(), 300);
				} catch (err) {
					console.error('Error handling drop:', err);
				}
			});
		});

		// Make course cards draggable
		const courseCards = document.querySelectorAll('.jct-course-card');
		courseCards.forEach(card => {
			card.setAttribute('draggable', 'true');

			card.addEventListener('dragstart', (e) => {
				const courseId = card.getAttribute('data-course-id');
				const courseName = getCourseNameFromCard(card);
				const courseUrl = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a')?.href || '#';

				e.dataTransfer.setData('text/plain', JSON.stringify({
					courseId: courseId,
					courseName: courseName,
					courseUrl: courseUrl,
					fromCourseList: true
				}));
				e.dataTransfer.effectAllowed = 'copy';
				card.style.opacity = '0.5';
			});

			card.addEventListener('dragend', () => {
				card.style.opacity = '1';
			});
		});
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

	// Cache for due dates (persistent)
	async function getDueDateCache() {
		return new Promise(resolve => {
			chrome.storage.local.get({ dueDateCache: {} }, res => {
				resolve(res.dueDateCache || {});
			});
		});
	}

	async function saveDueDateToCache(assignmentId, dueDate) {
		const cache = await getDueDateCache();
		cache[assignmentId] = dueDate ? dueDate.getTime() : null;
		return new Promise(resolve => {
			chrome.storage.local.set({ dueDateCache: cache }, () => resolve());
		});
	}

	// Helper function to extract due date from assignment page
	async function getAssignmentDueDate(assignmentUrl, assignmentId) {
		// Check cache first
		const cache = await getDueDateCache();
		if (cache[assignmentId] !== undefined) {
			return cache[assignmentId] ? new Date(cache[assignmentId]) : null;
		}

		try {
			const response = await fetch(assignmentUrl, {
				method: 'GET',
				credentials: 'include'
			});

			if (!response.ok) {
				await saveDueDateToCache(assignmentId, null);
				return null;
			}

			const html = await response.text();
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');

			// Look for the due date in the HTML
			// Pattern: <strong>מסתיים:</strong> יום רביעי, 30 אפריל 2025, 11:59 PM
			const bodyText = doc.body ? doc.body.innerHTML : html;

			// Look for "מסתיים:" or "Due date:" in the entire body
			if (bodyText.includes('מסתיים:') || bodyText.includes('Due date:')) {
				// Use regex directly on the body text to extract the date
				// Pattern: <strong>מסתיים:</strong> יום חמישי, 20 נובמבר 2025, 11:00 PM
				const dateRegex = /(?:מסתיים:|Due date:)<\/strong>\s*([^<]+)/;
				const match = bodyText.match(dateRegex);

				if (match) {
					const dateStr = match[1].trim();
					const dueDate = parseDueDate(dateStr);
					if (dueDate) {
						await saveDueDateToCache(assignmentId, dueDate);
						return dueDate;
					}
				}
			}

			await saveDueDateToCache(assignmentId, null);
			return null;
		} catch (error) {
			console.error('Error fetching assignment due date:', error);
			return null;
		}
	}

	// Helper function to parse Hebrew date string to Date object
	function parseDueDate(dateStr) {
		try {
			// Example: "יום חמישי, 18 דצמבר 2025, 11:55 PM"
			// Remove day name (Hebrew day names: ראשון, שני, שלישי, רביעי, חמישי, שישי, שבת)
			const cleaned = dateStr.replace(/יום [א-ת]+,\s*/, '').trim();

			// Hebrew months mapping
			const hebrewMonths = {
				'ינואר': 0, 'פברואר': 1, 'מרץ': 2, 'אפריל': 3,
				'מאי': 4, 'יוני': 5, 'יולי': 6, 'אוגוסט': 7,
				'ספטמבר': 8, 'אוקטובר': 9, 'נובמבר': 10, 'דצמבר': 11
			};

			// Pattern: "18 דצמבר 2025, 11:55 PM"
			// Split by comma first to separate date from time
			const [datePart, timePart] = cleaned.split(',').map(s => s.trim());

			// Split date part by spaces: ["18", "דצמבר", "2025"]
			const dateParts = datePart.split(/\s+/);

			if (dateParts.length >= 3) {
				const day = parseInt(dateParts[0]);
				const monthName = dateParts[1];
				const year = parseInt(dateParts[2]);
				const month = hebrewMonths[monthName];

				if (!isNaN(day) && month !== undefined && !isNaN(year)) {
					let hours = 23, minutes = 59;

					// Parse time if present
					if (timePart) {
						const timeMatch = timePart.match(/(\d+):(\d+)/);
						if (timeMatch) {
							hours = parseInt(timeMatch[1]);
							minutes = parseInt(timeMatch[2]);

							// Handle PM
							if (timePart.includes('PM') && hours < 12) {
								hours += 12;
							} else if (timePart.includes('AM') && hours === 12) {
								hours = 0;
							}
						}
					}

					return new Date(year, month, day, hours, minutes);
				}
			}

			return null;
		} catch (error) {
			console.error('Error parsing date:', error);
			return null;
		}
	}

	// Helper function to check if assignment should be shown based on due date
	function shouldShowAssignment(dueDate, maxOverdueDays) {
		if (!dueDate) return true; // If no due date, show it

		const now = new Date();
		const msPerDay = 24 * 60 * 60 * 1000;

		// If due date is in the future, always show
		if (dueDate >= now) return true;

		// If maxOverdueDays is 0, show all overdue assignments
		if (maxOverdueDays === 0) return true;

		// Calculate how many days overdue
		const daysOverdue = Math.floor((now - dueDate) / msPerDay);

		// Show only if within the allowed overdue window
		return daysOverdue <= maxOverdueDays;
	}

	// Cache helper functions
	async function getAssignmentsCache() {
		return new Promise(resolve => {
			chrome.storage.local.get({
				assignmentsCache: null,
				assignmentsCacheTimestamp: 0,
				assignmentsScanningInProgress: false
			}, res => {
				resolve({
					cache: res.assignmentsCache,
					timestamp: res.assignmentsCacheTimestamp,
					scanningInProgress: res.assignmentsScanningInProgress
				});
			});
		});
	}

	async function saveAssignmentsCache(assignments, courses) {
		const now = Date.now();
		return new Promise(resolve => {
			chrome.storage.local.set({
				assignmentsCache: { assignments, courses: Array.from(courses.entries()) },
				assignmentsCacheTimestamp: now,
				assignmentsScanningInProgress: false
			}, () => resolve());
		});
	}

	async function setScanningInProgress(inProgress) {
		return new Promise(resolve => {
			chrome.storage.local.set({
				assignmentsScanningInProgress: inProgress
			}, () => resolve());
		});
	}

	function isCacheValid(timestamp) {
		const now = Date.now();
		const oneWeekInMs = 7 * 24 * 60 * 60 * 1000; // 7 days (1 week)
		return (now - timestamp) < oneWeekInMs;
	}

	// Function to scan all courses and collect all assignments
	async function scanAllCoursesForAssignments(forceRefresh = false, filterYear = '', filterSemester = '') {
		// Check if already scanning
		const { cache, timestamp, scanningInProgress } = await getAssignmentsCache();

		// If already scanning, wait and return cached data if available
		if (scanningInProgress && !forceRefresh) {
			console.log('Scan already in progress, using cached data if available');
			if (cache) {
				return {
					assignments: cache.assignments || [],
					courses: new Map(cache.courses || [])
				};
			}
			// If no cache, wait a bit and try again
			await new Promise(resolve => setTimeout(resolve, 1000));
			return scanAllCoursesForAssignments(forceRefresh);
		}

		// Check cache first (unless force refresh)
		if (!forceRefresh) {
			if (cache && isCacheValid(timestamp)) {
				console.log('Using cached assignments data');
				return {
					assignments: cache.assignments || [],
					courses: new Map(cache.courses || [])
				};
			}
		}

		// Set scanning flag
		await setScanningInProgress(true);

		console.log('Fetching fresh assignments data...');

		let allAssignments = [];
		let allCourses = new Map(); // Track all courses, even without assignments

		try {

		// Get wwwroot from current URL or Moodle config
		let wwwroot = window.location.origin;

		// Try to get Moodle config, but don't fail if not available
		let moodleCfg = window.M?.cfg;
		if (!moodleCfg || !moodleCfg.wwwroot) {
			// Wait a bit for Moodle to initialize
			await new Promise(resolve => setTimeout(resolve, 500));
			moodleCfg = window.M?.cfg;
		}

		if (moodleCfg && moodleCfg.wwwroot) {
			wwwroot = moodleCfg.wwwroot;
		}

		console.log('Using wwwroot:', wwwroot);
		console.log('Filter settings:', { filterYear, filterSemester });

		// Find all course links in the main page HTML
		// Look for links like: <a class="aalink" href="https://moodle.jct.ac.il/course/view.php?id=73247">
		const allCourseLinks = document.querySelectorAll('a[href*="/course/view.php"]');

		console.log(`Found ${allCourseLinks.length} total course links`);

		// Use a Map to store unique courses by ID (to avoid duplicates)
		const uniqueCoursesMap = new Map();

		for (const link of allCourseLinks) {
			const href = link.getAttribute('href');
			const match = href.match(/[?&]id=(\d+)/);

			if (!match) continue;

			const courseId = match[1];
			const courseName = link.textContent.trim() || link.innerText.trim();

			// Only store the first occurrence of each course
			if (!uniqueCoursesMap.has(courseId)) {
				uniqueCoursesMap.set(courseId, { href, courseName, link });
			}
		}

		console.log(`Found ${uniqueCoursesMap.size} unique courses`);

		// Filter courses by year and semester BEFORE processing
		const filteredCourses = Array.from(uniqueCoursesMap.values()).filter(({ courseName }) => {
			// If no filter, include all
			if (!filterYear && !filterSemester) return true;

			// Parse year and semester from course name
			const { year, semIdx } = parseHebrewYearAndSemester(courseName);

			// Check year filter
			if (filterYear && year !== parseInt(filterYear)) {
				return false;
			}

			// Check semester filter
			if (filterSemester !== '' && semIdx !== parseInt(filterSemester)) {
				return false;
			}

			return true;
		});

		console.log(`After filtering: ${filteredCourses.length} courses match the filter`);

		const totalCourses = filteredCourses.length;
		let currentCourseIndex = 0;

		for (const { href, courseName: courseNameFromLink } of filteredCourses) {
			const match = href.match(/[?&]id=(\d+)/);

			if (!match) continue;

			const courseId = match[1];
			const courseName = courseNameFromLink || `קורס ${courseId}`;

			currentCourseIndex++;

			try {
				// Build absolute URL
				let courseUrl = href;
				if (!href.startsWith('http')) {
					if (href.startsWith('/')) {
						courseUrl = `${wwwroot}${href}`;
					} else {
						courseUrl = `${wwwroot}/${href}`;
					}
				}

				console.log(`Fetching course: ${courseName} (${courseId})`);

				// Update progress
				if (window.jctUpdateProgress) {
					window.jctUpdateProgress(currentCourseIndex, totalCourses, courseName);
				}

				// Track this course
				allCourses.set(courseId, { courseId, courseName, courseUrl });

				const response = await fetch(courseUrl, {
					method: 'GET',
					credentials: 'include'
				});

				if (response.ok) {
					const html = await response.text();
					const parser = new DOMParser();
					const doc = parser.parseFromString(html, 'text/html');

					// Use a Set to track unique assignment IDs and avoid duplicates
					const seenAssignmentIds = new Set();

					// Track assignments for THIS course only
					const courseAssignments = [];

					// Step 1: Find section links (course sections with images/topics)
					// Look for: <a href="https://moodle.jct.ac.il/course/section.php?id=327980">
					const sectionLinks = doc.querySelectorAll('a[href*="/course/section.php"]');

					console.log(`Found ${sectionLinks.length} section links in ${courseName}`);

					// Step 2: Fetch each section and look for assignments inside
					for (const sectionLink of sectionLinks) {
						const sectionHref = sectionLink.getAttribute('href');
						if (!sectionHref || sectionHref === '#') continue;

						const sectionMatch = sectionHref.match(/[?&]id=(\d+)/);
						if (!sectionMatch) continue;

						const sectionId = sectionMatch[1];

						try {
							// Build absolute URL for section
							let sectionUrl = sectionHref;
							if (!sectionHref.startsWith('http')) {
								if (sectionHref.startsWith('/')) {
									sectionUrl = `${wwwroot}${sectionHref}`;
								} else {
									sectionUrl = `${wwwroot}/${sectionHref}`;
								}
							}

							console.log(`  Fetching section ${sectionId} from ${courseName}`);

							const sectionResponse = await fetch(sectionUrl, {
								method: 'GET',
								credentials: 'include'
							});

							if (sectionResponse.ok) {
								const sectionHtml = await sectionResponse.text();
								const sectionParser = new DOMParser();
								const sectionDoc = sectionParser.parseFromString(sectionHtml, 'text/html');

								// Find assignment links in this section
								const assignmentLinks = sectionDoc.querySelectorAll('a[href*="/mod/assign/view.php"]');

								assignmentLinks.forEach(link => {
									const assignHref = link.getAttribute('href');

									// Skip if href is not valid
									if (!assignHref || assignHref === '#') {
										return;
									}

									const assignMatch = assignHref.match(/[?&]id=(\d+)/);
									if (assignMatch) {
										const assignId = assignMatch[1];

										// Skip if we've already seen this assignment ID
										if (seenAssignmentIds.has(assignId)) {
											return;
										}

										seenAssignmentIds.add(assignId);

										// Get assignment name from instancename span or link text
										const instanceNameEl = link.querySelector('.instancename');
										let name = instanceNameEl
											? instanceNameEl.textContent.trim()
											: link.textContent.trim() || '';

										// Skip if name is empty or too short
										if (!name || name.length < 3) {
											seenAssignmentIds.delete(assignId);
											return;
										}

										// Clean up name - remove extra whitespace
										name = name.replace(/\s+/g, ' ').trim();

										// Make sure URL is absolute
										let finalUrl = assignHref;
										if (!assignHref.startsWith('http')) {
											if (assignHref.startsWith('/')) {
												finalUrl = `${wwwroot}${assignHref}`;
											} else {
												finalUrl = `${wwwroot}/${assignHref}`;
											}
										}

										const assignment = {
											courseId: courseId,
											courseName: courseName,
											assignmentId: assignId,
											assignmentName: name,
											assignmentUrl: finalUrl,
											courseUrl: courseUrl
										};
										allAssignments.push(assignment);
										courseAssignments.push(assignment);
									}
								});
							}
						} catch (sectionError) {
							console.error(`Error fetching section ${sectionId}:`, sectionError);
						}
					}

					// Step 3: Also look for assignments directly in the course page
					// (some courses have assignments both in sections and on the main page)
					const directAssignmentLinks = doc.querySelectorAll('a[href*="/mod/assign/view.php"]');

					directAssignmentLinks.forEach(link => {
						const assignHref = link.getAttribute('href');

						// Skip if href is not valid
						if (!assignHref || assignHref === '#') {
							return;
						}

						const assignMatch = assignHref.match(/[?&]id=(\d+)/);
						if (assignMatch) {
							const assignId = assignMatch[1];

							// Skip if we've already seen this assignment ID
							if (seenAssignmentIds.has(assignId)) {
								return;
							}

							seenAssignmentIds.add(assignId);

							// Get assignment name from instancename span or link text
							const instanceNameEl = link.querySelector('.instancename');
							let name = instanceNameEl
								? instanceNameEl.textContent.trim()
								: link.textContent.trim() || '';

							// Skip if name is empty or too short
							if (!name || name.length < 3) {
								seenAssignmentIds.delete(assignId);
								return;
							}

							// Clean up name - remove extra whitespace
							name = name.replace(/\s+/g, ' ').trim();

							// Make sure URL is absolute
							let finalUrl = assignHref;
							if (!assignHref.startsWith('http')) {
								if (assignHref.startsWith('/')) {
									finalUrl = `${wwwroot}${assignHref}`;
								} else {
									finalUrl = `${wwwroot}/${assignHref}`;
								}
							}

							const assignment = {
								courseId: courseId,
								courseName: courseName,
								assignmentId: assignId,
								assignmentName: name,
								assignmentUrl: finalUrl,
								courseUrl: courseUrl
							};
							allAssignments.push(assignment);
							courseAssignments.push(assignment);
						}
					});

					console.log(`Added ${seenAssignmentIds.size} unique assignments from ${courseName}`);

					// Add course results to modal in real-time
					if (window.jctAddCourseResult) {
						window.jctAddCourseResult(
							{ courseId, courseName, courseUrl },
							courseAssignments
						);
					}
				}
			} catch (error) {
				console.error(`Error fetching assignments for course ${courseId}:`, error);

				// Still show the course even if there was an error
				if (window.jctAddCourseResult) {
					window.jctAddCourseResult(
						{ courseId, courseName, courseUrl },
						[]
					);
				}
			}
		}

		console.log(`Total assignments found: ${allAssignments.length}`);
		console.log(`Total courses scanned: ${allCourses.size}`);

		// Save to cache
		await saveAssignmentsCache(allAssignments, allCourses);
		console.log('Assignments cached successfully');

		return { assignments: allAssignments, courses: allCourses };

		} catch (error) {
			console.error('Error during assignments scan:', error);
			// Reset scanning flag on error
			await setScanningInProgress(false);
			throw error;
		}
	}

	// Function to show settings modal
	async function showSettingsModal() {
		// Hebrew years and semesters
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

		// Get current settings
		const settings = await new Promise(resolve => {
			chrome.storage.sync.get({
				paletteByYearHeb: null,
				columnCount: DEFAULT_COLUMN_COUNT,
				viewMode: 'grid',
				cardStyle: 'compact'
			}, res => resolve(res));
		});

		const palette = Array.isArray(settings.paletteByYearHeb) ? settings.paletteByYearHeb : DEFAULT_PALETTE;
		const columnCount = settings.columnCount || DEFAULT_COLUMN_COUNT;
		const viewMode = settings.viewMode || 'grid';
		const cardStyle = settings.cardStyle || 'compact';

		// Build color table HTML
		let tableHtml = '<tr><th>שנה\\סמסטר</th>';
		for (let sem of SEMESTERS) tableHtml += `<th>${sem}</th>`;
		tableHtml += '</tr>';
		for (let r = 0; r < HEBREW_YEARS.length; ++r) {
			tableHtml += `<tr><td><b>${HEBREW_YEARS[r].str}</b></td>`;
			for (let c = 0; c < SEMESTERS.length; ++c) {
				tableHtml += `<td><input type="color" id="jct-color-${r}-${c}" value="${palette[r][c]}" style="border:none;width:42px;height:32px;background:none;cursor:pointer;"></td>`;
			}
			tableHtml += '</tr>';
		}

		// Create modal
		const modal = document.createElement('div');
		modal.className = 'jct-assignments-modal';
		modal.innerHTML = `
			<div class="jct-assignments-modal-content" style="max-width: 700px;">
				<div class="jct-assignments-modal-header">
					<h3>⚙️ הגדרות</h3>
					<button class="jct-assignments-modal-close">✕</button>
				</div>
				<div class="jct-assignments-modal-body" style="padding: 24px;">
					<h4 style="margin: 0 0 16px; font-size: 16px;">צבעים לכל שנה ולכל סמסטר</h4>
					<table style="border-collapse:collapse;background:#fff;width:100%;border-radius:12px;box-shadow:0 4px 16px #0001;margin-bottom:24px;">
						${tableHtml}
					</table>
					<div style="margin: 24px 0 16px;">
						<label style="display: flex; align-items: center; gap: 8px; font-size: 14px;">
							<span>מספר עמודות (3–6):</span>
							<input id="jct-column-count" type="number" min="3" max="6" step="1" value="${columnCount}" style="width:60px;padding:6px;border:1px solid #cbd5e1;border-radius:6px;">
						</label>
					</div>
					<div style="margin: 16px 0;">
						<label style="display: flex; align-items: center; gap: 8px; font-size: 14px;">
							<span>תצוגת קורסים:</span>
							<select id="jct-view-mode" style="padding:6px 12px;border-radius:8px;border:1px solid #cbd5e1;">
								<option value="grid" ${viewMode === 'grid' ? 'selected' : ''}>בלוקים (ברירת מחדל)</option>
								<option value="list" ${viewMode === 'list' ? 'selected' : ''}>שורות</option>
							</select>
						</label>
					</div>
					<div style="margin: 16px 0;">
						<label style="display: flex; align-items: center; gap: 8px; font-size: 14px;">
							<span>עיצוב כרטיסים:</span>
							<select id="jct-card-style" style="padding:6px 12px;border-radius:8px;border:1px solid #cbd5e1;">
								<option value="compact" ${cardStyle === 'compact' ? 'selected' : ''}>קומפקטי (ברירת מחדל)</option>
								<option value="minimal" ${cardStyle === 'minimal' ? 'selected' : ''}>מינימליסטי</option>
								<option value="cards" ${cardStyle === 'cards' ? 'selected' : ''}>כרטיסים מעוגלים</option>
								<option value="modern" ${cardStyle === 'modern' ? 'selected' : ''}>מודרני</option>
							</select>
						</label>
					</div>
					<div style="margin-top: 24px; display: flex; gap: 12px;">
						<button id="jct-settings-save" style="padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; font-size: 14px;">שמירה</button>
						<button id="jct-settings-reset" style="padding: 10px 20px; background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1; border-radius: 8px; cursor: pointer; font-size: 14px;">איפוס לברירת מחדל</button>
					</div>
					<p style="color: #64748b; font-size: 12px; margin-top: 16px;">שנה = שורה. סמסטר = עמודה. שמור ורענן את העמוד כדי לראות את השינוי.</p>
				</div>
			</div>
		`;
		document.body.appendChild(modal);

		// Close button
		modal.querySelector('.jct-assignments-modal-close').addEventListener('click', () => {
			modal.remove();
		});

		// Click outside to close
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.remove();
			}
		});

		// Save button
		document.getElementById('jct-settings-save').addEventListener('click', async () => {
			// Read palette from UI
			const newPalette = [];
			for (let r = 0; r < HEBREW_YEARS.length; ++r) {
				newPalette[r] = [];
				for (let c = 0; c < SEMESTERS.length; ++c) {
					newPalette[r][c] = document.getElementById(`jct-color-${r}-${c}`).value || "#cccccc";
				}
			}

			// Read column count, view mode, and card style
			const newColumnCount = Math.max(3, Math.min(6, parseInt(document.getElementById('jct-column-count').value || 3)));
			const newViewMode = document.getElementById('jct-view-mode').value || 'grid';
			const newCardStyle = document.getElementById('jct-card-style').value || 'compact';

			// Save to storage
			await new Promise(resolve => {
				chrome.storage.sync.set({
					paletteByYearHeb: newPalette,
					columnCount: newColumnCount,
					viewMode: newViewMode,
					cardStyle: newCardStyle
				}, () => resolve());
			});

			// Apply view mode and card style immediately
			applyViewMode(newViewMode);
			applyCardStyle(newCardStyle);

			// Show success message
			const saveBtn = document.getElementById('jct-settings-save');
			const originalText = saveBtn.textContent;
			saveBtn.textContent = '✓ נשמר!';
			saveBtn.style.background = '#22c55e';
			setTimeout(() => {
				saveBtn.textContent = originalText;
				saveBtn.style.background = '#2563eb';
			}, 2000);
		});

		// Reset button
		document.getElementById('jct-settings-reset').addEventListener('click', async () => {
			await new Promise(resolve => {
				chrome.storage.sync.set({
					paletteByYearHeb: DEFAULT_PALETTE,
					columnCount: DEFAULT_COLUMN_COUNT,
					viewMode: 'grid',
					cardStyle: 'compact'
				}, () => resolve());
			});

			// Update UI
			for (let r = 0; r < HEBREW_YEARS.length; ++r) {
				for (let c = 0; c < SEMESTERS.length; ++c) {
					document.getElementById(`jct-color-${r}-${c}`).value = DEFAULT_PALETTE[r][c];
				}
			}
			document.getElementById('jct-column-count').value = DEFAULT_COLUMN_COUNT;
			document.getElementById('jct-view-mode').value = 'grid';
			document.getElementById('jct-card-style').value = 'compact';
			applyViewMode('grid');
			applyCardStyle('compact');
		});
	}

	// Function to show all assignments in a modal
	async function showAllAssignmentsModal() {
		// Get settings including filter preferences
		const settings = await new Promise(resolve => {
			chrome.storage.sync.get({
				maxOverdueDays: 30,
				assignmentFilterYear: '',
				assignmentFilterSemester: ''
			}, res => resolve(res));
		});
		const maxOverdueDays = settings.maxOverdueDays || 30;
		const savedFilterYear = settings.assignmentFilterYear || '';
		const savedFilterSemester = settings.assignmentFilterSemester || '';

		// Create modal with live results
		const modal = document.createElement('div');
		modal.className = 'jct-assignments-modal';
		modal.innerHTML = `
			<div class="jct-assignments-modal-content jct-assignments-modal-large">
				<div class="jct-assignments-modal-header">
					<h3 id="jct-modal-title">טוען קורסים...</h3>
					<button class="jct-assignments-modal-close">✕</button>
				</div>
				<div class="jct-filter-controls" style="padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
					<label style="display: flex; align-items: center; gap: 8px;">
						<span style="font-weight: 500;">שנה:</span>
						<select id="jct-filter-year" style="padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; cursor: pointer;">
							<option value="" ${savedFilterYear === '' ? 'selected' : ''}>הכל</option>
							<option value="5784" ${savedFilterYear === '5784' ? 'selected' : ''}>תשפ"ד</option>
							<option value="5785" ${savedFilterYear === '5785' ? 'selected' : ''}>תשפ"ה</option>
							<option value="5786" ${savedFilterYear === '5786' ? 'selected' : ''}>תשפ"ו</option>
							<option value="5787" ${savedFilterYear === '5787' ? 'selected' : ''}>תשפ"ז</option>
							<option value="5788" ${savedFilterYear === '5788' ? 'selected' : ''}>תשפ"ח</option>
							<option value="5789" ${savedFilterYear === '5789' ? 'selected' : ''}>תשפ"ט</option>
							<option value="5790" ${savedFilterYear === '5790' ? 'selected' : ''}>תש"צ</option>
						</select>
					</label>
					<label style="display: flex; align-items: center; gap: 8px;">
						<span style="font-weight: 500;">סמסטר:</span>
						<select id="jct-filter-semester" style="padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; cursor: pointer;">
							<option value="" ${savedFilterSemester === '' ? 'selected' : ''}>הכל</option>
							<option value="0" ${savedFilterSemester === '0' ? 'selected' : ''}>אלול</option>
							<option value="1" ${savedFilterSemester === '1' ? 'selected' : ''}>א'</option>
							<option value="2" ${savedFilterSemester === '2' ? 'selected' : ''}>ב'</option>
						</select>
					</label>
					<label style="display: flex; align-items: center; gap: 8px;">
						<span style="font-weight: 500;">הסתר מטלות באיחור (ימים):</span>
						<input id="jct-max-overdue-days" type="number" min="0" step="1" value="${maxOverdueDays}" style="width: 70px; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: white;">
						<span style="font-size: 0.75rem; color: #64748b;">(0 = הצג תמיד)</span>
					</label>
					<button id="jct-refresh-assignments" style="padding: 6px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
						🔄 רענן
					</button>
				</div>
				<div class="jct-modal-status" style="padding: 12px 24px; background: #f8fafc; border-bottom: 1px solid #e5e7eb;">
					<div id="jct-loading-status" style="font-size: 0.875rem; color: #64748b;">
						<span class="jct-loading-spinner-small"></span> מתחיל סריקה...
					</div>
				</div>
				<div class="jct-assignments-modal-body" id="jct-results-container">
					<!-- Results will be added here dynamically -->
				</div>
			</div>
		`;
		document.body.appendChild(modal);

		// Close button
		modal.querySelector('.jct-assignments-modal-close').addEventListener('click', () => {
			modal.remove();
			window.jctStopScanning = true;
		});

		// Click outside to close
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.remove();
				window.jctStopScanning = true;
			}
		});

		// Track totals
		let totalCourses = 0;
		let totalAssignments = 0;

		// Create progress updater function
		window.jctUpdateProgress = (current, total, courseName) => {
			const statusEl = document.getElementById('jct-loading-status');
			if (statusEl) {
				statusEl.innerHTML = `<span class="jct-loading-spinner-small"></span> סורק קורס ${current} מתוך ${total}: ${courseName}`;
			}
		};

		// Create course result adder function
		window.jctAddCourseResult = (courseInfo, assignments) => {
			const container = document.getElementById('jct-results-container');
			if (!container) return;

			totalCourses++;
			totalAssignments += assignments.length;

			const courseDiv = document.createElement('div');
			courseDiv.className = 'jct-course-assignments-group';

			let html = `
				<h4 class="jct-course-group-title">
					<a href="${courseInfo.courseUrl}" target="_blank">${courseInfo.courseName}</a>
					<span class="jct-assignment-count">(${assignments.length})</span>
				</h4>
			`;

			if (assignments.length === 0) {
				html += `<div class="jct-no-assignments">אין מטלות בקורס זה</div>`;
			} else {
				html += `<div class="jct-assignments-list-modal">`;

				assignments.forEach(assign => {
					// Format due date
					let dueDateHtml = '';
					if (assign.dueDate) {
						const now = new Date();
						const dueDate = assign.dueDate instanceof Date ? assign.dueDate : new Date(assign.dueDate);
						const isOverdue = dueDate < now;
						const msPerDay = 24 * 60 * 60 * 1000;
						const daysUntilDue = Math.ceil((dueDate - now) / msPerDay);

						let dateColor = '#64748b'; // default gray
						let dateText = '';

						if (isOverdue) {
							const daysOverdue = Math.floor((now - dueDate) / msPerDay);
							dateColor = '#dc2626'; // red
							dateText = `באיחור ${daysOverdue} ${daysOverdue === 1 ? 'יום' : 'ימים'}`;
						} else if (daysUntilDue <= 3) {
							dateColor = '#ea580c'; // orange
							dateText = `נשאר ${daysUntilDue} ${daysUntilDue === 1 ? 'יום' : 'ימים'}`;
						} else if (daysUntilDue <= 7) {
							dateColor = '#eab308'; // yellow
							dateText = `נשאר ${daysUntilDue} ימים`;
						} else {
							dateColor = '#16a34a'; // green
							dateText = `נשאר ${daysUntilDue} ימים`;
						}

						const formattedDate = dueDate.toLocaleDateString('he-IL', {
							day: 'numeric',
							month: 'long',
							year: 'numeric'
						});

						dueDateHtml = `
							<div class="jct-assignment-due-date" style="font-size: 0.75rem; color: ${dateColor}; margin-top: 4px; font-weight: 500;">
								📅 ${formattedDate} (${dateText})
							</div>
						`;
					} else {
						// No due date available
						dueDateHtml = `
							<div class="jct-assignment-due-date" style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px; font-style: italic;">
								⏰ אין תאריך סיום
							</div>
						`;
					}

					html += `
						<div class="jct-assignment-box">
							<div class="jct-assignment-box-name">${assign.assignmentName}</div>
							${dueDateHtml}
							<a href="${assign.assignmentUrl}" class="jct-assignment-box-link" target="_blank">פתח מטלה →</a>
						</div>
					`;
				});

				html += `</div>`;
			}

			courseDiv.innerHTML = html;
			container.appendChild(courseDiv);

			// Update title
			const titleEl = document.getElementById('jct-modal-title');
			if (titleEl) {
				titleEl.textContent = `כל הקורסים (${totalCourses}) | מטלות (${totalAssignments})`;
			}
		};

		// Function to load and display assignments
		async function loadAndDisplayAssignments(forceRefresh = false) {
			// Clear existing results
			const container = document.getElementById('jct-results-container');
			if (container) {
				container.innerHTML = '';
				totalCourses = 0;
				totalAssignments = 0;
			}

			// Update status
			const statusEl = document.getElementById('jct-loading-status');
			if (statusEl) {
				if (forceRefresh) {
					statusEl.innerHTML = `<span class="jct-loading-spinner-small"></span> מרענן נתונים...`;
				} else {
					statusEl.innerHTML = `<span class="jct-loading-spinner-small"></span> טוען נתונים...`;
				}
			}

			// Get filter values from the UI
			const filterYear = document.getElementById('jct-filter-year')?.value || '';
			const filterSemester = document.getElementById('jct-filter-semester')?.value || '';
			const maxOverdueDays = parseInt(document.getElementById('jct-max-overdue-days')?.value || '30');

			// Scan all courses
			window.jctStopScanning = false;
			const result = await scanAllCoursesForAssignments(forceRefresh, filterYear, filterSemester);

			// Display results (either from cache or fresh scan)
			if (result) {
				if (statusEl) {
					statusEl.innerHTML = `<span class="jct-loading-spinner-small"></span> בודק תאריכי סיום...`;
				}

				// Fetch due dates for all assignments and filter
				const assignmentsWithDates = await Promise.all(
					result.assignments.map(async (assign) => {
						const dueDate = await getAssignmentDueDate(assign.assignmentUrl, assign.assignmentId);
						return { ...assign, dueDate };
					})
				);

				// Filter assignments by due date
				const filteredAssignments = assignmentsWithDates.filter(assign =>
					shouldShowAssignment(assign.dueDate, maxOverdueDays)
				);

				// Clear previous results and reset counters
				const container = document.getElementById('jct-results-container');
				if (container) {
					container.innerHTML = '';
				}
				totalCourses = 0;
				totalAssignments = 0;

				// Display all courses with filtered assignments
				for (const [courseId, courseInfo] of result.courses) {
					const courseAssignments = filteredAssignments.filter(a => a.courseId === courseId);
					if (window.jctAddCourseResult) {
						window.jctAddCourseResult(courseInfo, courseAssignments);
					}
				}
			}

			// Update final status
			if (statusEl) {
				const { timestamp } = await getAssignmentsCache();
				const cacheDate = new Date(timestamp);
				const cacheTime = cacheDate.toLocaleString('he-IL');
				const totalBeforeFilter = result ? result.assignments.length : 0;
				const hiddenCount = totalBeforeFilter - totalAssignments;
				let statusText = `✓ סריקה הושלמה - ${totalCourses} קורסים, ${totalAssignments} מטלות`;
				if (hiddenCount > 0) {
					statusText += ` (${hiddenCount} מוסתרות בגלל תאריך סיום)`;
				}
				statusText += ` | עדכון אחרון: ${cacheTime}`;
				statusEl.innerHTML = statusText;
			}
		}

		// Add event listeners for filters and refresh button
		const filterYearSelect = document.getElementById('jct-filter-year');
		const filterSemesterSelect = document.getElementById('jct-filter-semester');
		const maxOverdueDaysInput = document.getElementById('jct-max-overdue-days');
		const refreshBtn = document.getElementById('jct-refresh-assignments');

		// When filter changes, reload assignments
		filterYearSelect?.addEventListener('change', () => {
			loadAndDisplayAssignments(false);
		});

		filterSemesterSelect?.addEventListener('change', () => {
			loadAndDisplayAssignments(false);
		});

		// When maxOverdueDays changes, save to storage and reload
		maxOverdueDaysInput?.addEventListener('change', async () => {
			const newValue = Math.max(0, parseInt(maxOverdueDaysInput.value || '30'));
			await new Promise(resolve => {
				chrome.storage.sync.set({ maxOverdueDays: newValue }, () => resolve());
			});
			loadAndDisplayAssignments(false);
		});

		// Refresh button click handler
		refreshBtn?.addEventListener('click', async (e) => {
			const clearCache = e.shiftKey;

			refreshBtn.disabled = true;
			refreshBtn.innerHTML = clearCache ? '⏳ מנקה מטמון...' : '⏳ מרענן...';

			if (clearCache) {
				// Clear due date cache
				await new Promise(resolve => {
					chrome.storage.local.set({ dueDateCache: {} }, () => resolve());
				});
			}

			await loadAndDisplayAssignments(true);
			refreshBtn.disabled = false;
			refreshBtn.innerHTML = '🔄 רענן';
		});

		// Load assignments (use cache if available)
		await loadAndDisplayAssignments(false);
	}

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
			showSettingsModal();
		});

		// Add "Show All Assignments" button
		const assignmentsBtn = document.createElement('button');
		assignmentsBtn.id = 'jct-show-all-assignments-button';
		assignmentsBtn.className = 'jct-settings-button jct-assignments-button';
		assignmentsBtn.innerHTML = '📝 כל המטלות';
		assignmentsBtn.title = 'הצג את כל המטלות מכל הקורסים';

		assignmentsBtn.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Prevent multiple clicks
			if (assignmentsBtn.disabled) return;

			// Check if modal already open
			if (document.querySelector('.jct-assignments-modal')) return;

			assignmentsBtn.disabled = true;
			assignmentsBtn.innerHTML = '⏳ טוען...';

			try {
				await showAllAssignmentsModal();
			} finally {
				assignmentsBtn.disabled = false;
				assignmentsBtn.innerHTML = '📝 כל המטלות';
			}
		});

		// Add to page header on the LEFT side (in RTL this is visually on the RIGHT side of screen)
		if (pageTitleContainer) {
			// Add at the END of the title container (will be on the left/right side in RTL)
			pageTitleContainer.appendChild(assignmentsBtn);
			pageTitleContainer.appendChild(settingsBtn);
		} else if (mainTitle && mainTitle.parentElement) {
			// Add after the title
			if (mainTitle.nextSibling) {
				mainTitle.parentElement.insertBefore(assignmentsBtn, mainTitle.nextSibling);
				mainTitle.parentElement.insertBefore(settingsBtn, mainTitle.nextSibling);
			} else {
				mainTitle.parentElement.appendChild(assignmentsBtn);
				mainTitle.parentElement.appendChild(settingsBtn);
			}
		} else if (pageHeader) {
			// Add to page header at the end
			pageHeader.appendChild(assignmentsBtn);
			pageHeader.appendChild(settingsBtn);
		} else {
			// Fallback: fixed position top left (right in RTL)
			assignmentsBtn.style.position = 'fixed';
			assignmentsBtn.style.top = '20px';
			assignmentsBtn.style.left = '80px';
			assignmentsBtn.style.zIndex = '10000';
			settingsBtn.style.position = 'fixed';
			settingsBtn.style.top = '20px';
			settingsBtn.style.left = '20px';
			settingsBtn.style.zIndex = '10000';
			document.body.appendChild(assignmentsBtn);
			document.body.appendChild(settingsBtn);
		}
	}

	function applyCoursePageColors() {
		// Check if we're on a course page
		const body = document.body;
		if (!body.classList.contains('pagelayout-course') && !body.classList.contains('pagelayout-incourse')) {
			return;
		}

		// Get course ID from URL
		const urlParams = new URLSearchParams(window.location.search);
		const courseId = urlParams.get('id');
		if (!courseId) return;

		// Try to get course name from page
		const pageTitle = document.querySelector('.page-header-headings h1, #page-header h1, .page-context-header h1');
		const courseName = pageTitle ? pageTitle.textContent.trim() : '';

		// Parse year and semester from course name or use course ID
		let { year, semIdx } = parseHebrewYearAndSemester(courseName);
		if (year == null || semIdx == null) {
			// Fallback: derive from course ID
			const cid = String(courseId);
			let hash = 0;
			for (let i = 0; i < cid.length; i++) {
				hash = ((hash << 5) - hash) + cid.charCodeAt(i);
				hash |= 0;
			}
			const row = Math.abs(hash) % HEBREW_YEARS.length;
			year = HEBREW_YEARS[row];
			const sems = [0, 1, 2];
			semIdx = sems[Math.abs(hash >> 3) % sems.length];
		}

		// Get color for this course
		const { h, s, l } = colorFor(year, semIdx);

		// Apply CSS variables to the document root
		document.documentElement.style.setProperty('--jct-course-h', String(h));
		document.documentElement.style.setProperty('--jct-course-s', String(s) + '%');
		document.documentElement.style.setProperty('--jct-course-l', String(l) + '%');

		// Add class to indicate course page has colors applied
		document.documentElement.classList.add('jct-course-page-themed');
	}

	docReady(async () => {
		document.documentElement.classList.add('jct-moodle-redesign');
		const html = document.documentElement;
		if (html.dir === 'rtl') html.classList.add('jct-rtl');
		await Promise.all([loadPaletteHeb(), loadFavorites(), loadCourseSchedules(), loadCourseAssignments(), loadViewMode()]);
		markCoursesContainers();
		ensureStructureAndColor();
		relocateTopBlocksAfterCourses();
		hideFrontClutter();
		createWeeklyScheduleView();
		addSettingsButton();
		applyCoursePageColors();

		// Auto-update assignments cache if needed (runs in background)
		setTimeout(async () => {
			const { cache, timestamp } = await getAssignmentsCache();
			if (!cache || !isCacheValid(timestamp)) {
				console.log('Assignment cache expired or missing, updating in background...');
				try {
					await scanAllCoursesForAssignments(true);
					console.log('Assignment cache updated successfully');
				} catch (error) {
					console.error('Error updating assignment cache:', error);
				}
			} else {
				console.log('Assignment cache is still valid');
			}
		}, 2000); // Wait 2 seconds after page load to avoid slowing down initial render

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
				if (area === 'sync' && changes.viewMode) {
					currentViewMode = changes.viewMode.newValue || 'grid';
					applyViewMode(currentViewMode);
				}
				if (area === 'sync' && changes.cardStyle) {
					currentCardStyle = changes.cardStyle.newValue || 'compact';
					applyCardStyle(currentCardStyle);
				}
			});
		}
	});
})();
