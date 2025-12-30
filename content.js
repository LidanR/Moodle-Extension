// Inject small runtime tweaks after CSS applies
(function () {
	const docReady = (fn) => {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', fn, { once: true });
		} else {
			fn();
		}
	};

	const HEBREW_YEARS = [5784, 5785, 5786, 5787, 5788, 5789, 5790];
	const SEM_TO_IDX = { 'אלול': 0, '1': 0, 'א': 1, '2': 1, 'ב': 2, '3': 2 };
	const DEFAULT_PALETTE = [
		["#3b82f6", "#818cf8", "#bae6fd"], // 5784
		["#22c55e", "#4ade80", "#bbf7d0"], // 5785
		["#f97316", "#fbbf24", "#fed7aa"], // 5786
		["#f43f5e", "#fda4af", "#fecdd3"], // 5787
		["#a21caf", "#f472b6", "#f3e8ff"], // 5788
		["#2563eb", "#60a5fa", "#dbeafe"], // 5789
		["#b45309", "#f59e42", "#fde68a"]  // 5790
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
		document.body.classList.remove('jct-style-compact', 'jct-style-minimal', 'jct-style-cards', 'jct-style-modern', 'jct-style-glass');

		// Add the selected style class
		document.body.classList.add(`jct-style-${style}`);
	}

	// Function to apply view mode
	function applyViewMode(mode) {
		currentViewMode = mode;

		// Remove all view mode classes
		document.body.classList.remove('jct-courses-list-view', 'jct-view-original', 'jct-view-carousel');

		// Apply to all possible course containers
		const containers = document.querySelectorAll('.jct-courses-grid');
		containers.forEach(coursesContainer => {
			const parentContainer = coursesContainer.closest('.course-content, #frontpage-course-list, .courses') || coursesContainer.parentElement;
			if (parentContainer) {
				parentContainer.classList.remove('jct-courses-list-view', 'jct-view-original', 'jct-view-carousel');

				if (mode === 'list') {
					parentContainer.classList.add('jct-courses-list-view');
				} else if (mode === 'original') {
					parentContainer.classList.add('jct-view-original');
				} else if (mode === 'carousel') {
					parentContainer.classList.add('jct-view-carousel');
				}
			}
		});

		// Apply to body for global scope
		if (mode === 'list') {
			document.body.classList.add('jct-courses-list-view');
			restoreOriginalCourses();
		} else if (mode === 'original') {
			document.body.classList.add('jct-view-original');
			restoreOriginalCourses();
		} else if (mode === 'carousel') {
			document.body.classList.add('jct-view-carousel');
			// Only initialize carousel if it doesn't already exist
			const containers = document.querySelectorAll('.jct-courses-grid');
			let needsInit = false;
			containers.forEach(container => {
				if (!container.querySelector('.jct-semester-group')) {
					needsInit = true;
				}
			});
			if (needsInit) {
				initializeCarouselView();
			}
		} else {
			// Grid mode (default)
			restoreOriginalCourses();
			// Apply column count for grid view
			chrome.storage.sync.get({ columnCount: 3 }, ({ columnCount }) => {
				document.documentElement.style.setProperty('--jct-columns', columnCount);
			});
		}
	}

	// Store original courses before carousel transformation
	const originalCoursesMap = new WeakMap();

	// Function to initialize carousel view
	function initializeCarouselView() {
		const containers = document.querySelectorAll('.jct-courses-grid');
		containers.forEach(container => {
			// Check if carousel already exists in this container
			const existingCarousel = container.querySelector('.jct-semester-group');
			if (existingCarousel) {
				// Carousel already exists, don't rebuild
				return;
			}

			// Mark container as having carousel to prevent future rebuilds
			container.setAttribute('data-jct-carousel-initialized', 'true');

			// Get all courses and save original structure (exclude paging buttons)
			const courses = Array.from(container.children).filter(child =>
				!child.classList.contains('paging') &&
				!child.classList.contains('paging-morelink')
			);

			if (courses.length === 0) return;

			// Save original courses for restoration later
			if (!originalCoursesMap.has(container)) {
				originalCoursesMap.set(container, courses.map(course => course.cloneNode(true)));
			}

			// Clone courses for carousel
			const clonedCourses = courses.map(course => {
				const cloned = course.cloneNode(true);

				// Extract and set courseId from original card's URL
				let courseId = null;
				const originalLink = course.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a');
				if (originalLink && originalLink.href) {
					const match = originalLink.href.match(/[?&]id=(\d+)/);
					if (match) {
						courseId = match[1];
					}
				}

				// If found, set it on the cloned card
				if (courseId) {
					cloned.setAttribute('data-course-id', courseId);
				}

				// Make entire card clickable
				const mainLink = cloned.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a');
				if (mainLink && mainLink.href) {
					cloned.style.cursor = 'pointer';
					cloned.addEventListener('click', (e) => {
						// Don't trigger if clicking on buttons or other interactive elements
						if (e.target.closest('button, .jct-fav-toggle, .jct-schedule-btn')) {
							return;
						}
						// Open the course link
						window.location.href = mainLink.href;
					});
				}

				// Ensure links are clickable in cloned courses
				const links = cloned.querySelectorAll('a');
				links.forEach(link => {
					link.style.pointerEvents = 'auto';
					link.style.cursor = 'pointer';
				});

				// Add drag-and-drop functionality for schedule
				cloned.setAttribute('draggable', 'true');

				let scrollInterval = null;

				cloned.addEventListener('dragstart', (e) => {
					const courseId = cloned.getAttribute('data-course-id');
					const courseName = getCourseNameFromCard(cloned);
					const courseUrl = cloned.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a')?.href || '#';

					e.dataTransfer.setData('text/plain', JSON.stringify({
						courseId: courseId,
						courseName: courseName,
						courseUrl: courseUrl,
						fromCourseList: true
					}));
					e.dataTransfer.effectAllowed = 'copy';
					cloned.style.opacity = '0.5';
				});

				cloned.addEventListener('drag', (e) => {
					// Auto-scroll when dragging near edges
					const scrollThreshold = 80; // Distance from edge to trigger scroll
					const scrollSpeed = 15; // Pixels to scroll per interval

					if (e.clientY > 0 && e.clientY < window.innerHeight) {
						// Clear any existing scroll interval
						if (scrollInterval) {
							clearInterval(scrollInterval);
							scrollInterval = null;
						}

						// Check if near top edge
						if (e.clientY < scrollThreshold) {
							scrollInterval = setInterval(() => {
								window.scrollBy(0, -scrollSpeed);
							}, 20);
						}
						// Check if near bottom edge
						else if (e.clientY > window.innerHeight - scrollThreshold) {
							scrollInterval = setInterval(() => {
								window.scrollBy(0, scrollSpeed);
							}, 20);
						}
					}
				});

				cloned.addEventListener('dragend', () => {
					cloned.style.opacity = '1';
					// Clear scroll interval when drag ends
					if (scrollInterval) {
						clearInterval(scrollInterval);
						scrollInterval = null;
					}
				});

				return cloned;
			});

			// Group courses by color (year + semester)
			const coursesByColor = new Map();
			clonedCourses.forEach(course => {
				const h = course.style.getPropertyValue('--jct-accent-h') || '230';
				const s = course.style.getPropertyValue('--jct-accent-s') || '70%';
				const l = course.style.getPropertyValue('--jct-accent-l') || '55%';
				const colorKey = `${h}-${s}-${l}`;

				if (!coursesByColor.has(colorKey)) {
					coursesByColor.set(colorKey, []);
				}
				coursesByColor.get(colorKey).push(course);
			});

			// Clear container
			container.innerHTML = '';

			// Create a carousel for each color group
			coursesByColor.forEach((groupCourses, colorKey) => {
				const semesterDiv = document.createElement('div');
				semesterDiv.className = 'jct-semester-group';

				// Get semester name from first course in group
				const firstCourse = groupCourses[0];
				const text = firstCourse.innerText || firstCourse.textContent || '';
				const { year, semIdx } = parseHebrewYearAndSemester(text);
				const semesterName = getSemesterName(year, semIdx);

				const header = document.createElement('div');
				header.className = 'jct-semester-header';
				header.textContent = semesterName || 'קורסים';
				semesterDiv.appendChild(header);

				const carouselWrapper = document.createElement('div');
				carouselWrapper.className = 'jct-carousel-wrapper';

				const carouselContainer = document.createElement('div');
				carouselContainer.className = 'jct-carousel-container';
				carouselContainer.setAttribute('data-carousel-index', '0');

				groupCourses.forEach(course => {
					carouselContainer.appendChild(course);
				});

				carouselWrapper.appendChild(carouselContainer);
				semesterDiv.appendChild(carouselWrapper);

				// Add navigation buttons if more than 1 course
				if (groupCourses.length > 1) {
					const prevBtn = document.createElement('button');
					prevBtn.className = 'jct-carousel-btn jct-carousel-btn-prev';
					prevBtn.innerHTML = '◀';
					prevBtn.disabled = true; // Start disabled (at first item)
					prevBtn.addEventListener('click', () => moveCarousel(carouselContainer, -1, groupCourses.length));

					const nextBtn = document.createElement('button');
					nextBtn.className = 'jct-carousel-btn jct-carousel-btn-next';
					nextBtn.innerHTML = '▶';
					nextBtn.addEventListener('click', () => moveCarousel(carouselContainer, 1, groupCourses.length));

					semesterDiv.appendChild(prevBtn);
					semesterDiv.appendChild(nextBtn);

					// Add indicators
					const indicators = document.createElement('div');
					indicators.className = 'jct-carousel-indicators';
					for (let i = 0; i < groupCourses.length; i++) {
						const dot = document.createElement('div');
						dot.className = 'jct-carousel-dot' + (i === 0 ? ' active' : '');
						dot.addEventListener('click', () => moveCarouselToIndex(carouselContainer, i, groupCourses.length, indicators));
						indicators.appendChild(dot);
					}
					semesterDiv.appendChild(indicators);
				}

				container.appendChild(semesterDiv);
			});
		});
	}

	// Helper function to get semester name
	function getSemesterName(year, semIdx) {
		if (!year || semIdx == null) return 'קורסים';
		const semesterNames = ['סמסטר אלול', 'סמסטר א׳', 'סמסטר ב׳'];

		// Convert Hebrew year to readable format
		const hebrewYearNames = {
			5784: 'תשפ״ד',
			5785: 'תשפ״ה',
			5786: 'תשפ״ו',
			5787: 'תשפ״ז',
			5788: 'תשפ״ח',
			5789: 'תשפ״ט',
			5790: 'תש״ץ'
		};

		const yearName = hebrewYearNames[year] || year;
		return `${semesterNames[semIdx] || 'סמסטר'} ${yearName}`;
	}

	// Function to restore original courses when leaving carousel mode
	function restoreOriginalCourses() {
		const containers = document.querySelectorAll('.jct-courses-grid');
		containers.forEach(container => {
			// Check if this container has carousel structure
			if (container.querySelector('.jct-semester-group')) {
				// Get original courses from map
				const originalCourses = originalCoursesMap.get(container);
				if (originalCourses) {
					// Clear container
					container.innerHTML = '';
					// Restore original courses
					originalCourses.forEach(course => {
						container.appendChild(course.cloneNode(true));
					});
					// Remove carousel initialization flag
					container.removeAttribute('data-jct-carousel-initialized');
				}
			}
		});
	}

	// Move carousel helper function
	function moveCarousel(container, direction, totalItems) {
		const currentIndex = parseInt(container.getAttribute('data-carousel-index') || '0');
		let newIndex = currentIndex + direction;

		// Don't loop - stop at boundaries
		if (newIndex < 0) newIndex = 0;
		if (newIndex >= totalItems) newIndex = totalItems - 1;

		container.setAttribute('data-carousel-index', newIndex);
		// For RTL, use positive values to move left (showing next cards in RTL)
		const offset = newIndex * (320 + 20); // card width + gap
		container.style.transform = `translateX(${offset}px)`;

		// Update button states
		const semesterGroup = container.closest('.jct-semester-group');
		if (semesterGroup) {
			const prevBtn = semesterGroup.querySelector('.jct-carousel-btn-prev');
			const nextBtn = semesterGroup.querySelector('.jct-carousel-btn-next');
			if (prevBtn) prevBtn.disabled = newIndex === 0;
			if (nextBtn) nextBtn.disabled = newIndex === totalItems - 1;

			// Update indicators
			const indicators = semesterGroup.querySelector('.jct-carousel-indicators');
			if (indicators) {
				const dots = indicators.querySelectorAll('.jct-carousel-dot');
				dots.forEach((dot, idx) => {
					dot.classList.toggle('active', idx === newIndex);
				});
			}
		}
	}

	// Move carousel to specific index
	function moveCarouselToIndex(container, index, totalItems, indicatorsEl) {
		container.setAttribute('data-carousel-index', index);
		// For RTL, use positive values to move left (showing next cards in RTL)
		const offset = index * (320 + 20);
		container.style.transform = `translateX(${offset}px)`;

		// Update button states
		const semesterGroup = container.closest('.jct-semester-group');
		if (semesterGroup) {
			const prevBtn = semesterGroup.querySelector('.jct-carousel-btn-prev');
			const nextBtn = semesterGroup.querySelector('.jct-carousel-btn-next');
			if (prevBtn) prevBtn.disabled = index === 0;
			if (nextBtn) nextBtn.disabled = index === totalItems - 1;
		}

		// Update indicators
		const dots = indicatorsEl.querySelectorAll('.jct-carousel-dot');
		dots.forEach((dot, idx) => {
			dot.classList.toggle('active', idx === index);
		});
	}
	let isSavingSchedules = false;

	function scheduleLightUpdate() {
		if (scheduled || isReordering) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;

			// If in carousel mode and carousel already exists, skip heavy updates
			if (currentViewMode === 'carousel') {
				const hasCarousel = document.querySelector('.jct-courses-grid .jct-semester-group');
				if (hasCarousel) {
					// Carousel already exists, don't rebuild everything
					return;
				}
			}

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
							saveCourseAssignments().catch(() => { });
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
															saveCourseAssignments().catch(() => { });
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
													saveCourseAssignments().catch(() => { });
												}
											}
										}
									}
								}).catch(() => { });
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
						saveCourseAssignments().catch(() => { });
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
		try {
			// Reorder both regular grids and carousel containers
			document.querySelectorAll('.jct-courses-grid').forEach(reorderContainerByFavorites);
			document.querySelectorAll('.jct-carousel-container').forEach(reorderContainerByFavorites);
		}
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
		hex = (hex || '').replace('#', '');
		if (!hex) return { h: 220, s: 60, l: 60 };
		if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
		const r = parseInt(hex.substring(0, 2), 16) / 255;
		const g = parseInt(hex.substring(2, 4), 16) / 255;
		const b = parseInt(hex.substring(4, 6), 16) / 255;
		const max = Math.max(r, g, b), min = Math.min(r, g, b);
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
			const lookup = { 'תשפ"ד': 5784, 'תשפ"ה': 5785, 'תשפ"ו': 5786, 'תשפ"ז': 5787, 'תשפ"ח': 5788, 'תשפ"ט': 5789, 'תש"צ': 5790 };
			const cy = yMatch[0].replace("'", '"');
			y = lookup[cy];
		}
		if (!y) {
			const nMatch = txt.match(/57[8-9][0-9]/);
			y = nMatch ? parseInt(nMatch[0], 10) : null;
		}
		// Detect semester
		let sMatch = null;
		if (txt.includes('אלול')) s = 0;
		else if ((sMatch = txt.match(/(?<=^|\W)(א|ב|1|2|3)(?=\W|$)/))) s = SEM_TO_IDX[sMatch[1]];
		else s = null;
		return { year: y, semIdx: s };
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
				maxOverdueDays = settings.maxOverdueDays !== undefined ? settings.maxOverdueDays : 30;
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
			// Note: We used to skip carousel cards, but that prevented buttons from working
			// Now we process all cards including carousel cards

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
				const sems = [0, 1, 2];
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
				// Insert as first child to be above thumb-wrap in DOM order
				card.insertBefore(favBtn, card.firstChild);
			}

			// Always set the click handler - use onclick to override any existing handler
			favBtn.onclick = (e) => {
				e.stopPropagation();
				e.preventDefault();
				const cid = getCourseIdFromCard(card);
				toggleFavorite(cid);
			};

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
				// Insert as first child to be above thumb-wrap in DOM order
				card.insertBefore(scheduleBtn, card.firstChild);
			}

			// Always set the click handler - use onclick to override any existing handler
			scheduleBtn.onclick = (e) => {
				e.stopPropagation();
				e.preventDefault();
				showScheduleDayPicker(courseId, card);
			};

			// Set dragstart handler (can't use ondragstart for this complex logic)
			scheduleBtn.ondragstart = (e) => {
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
				e.dataTransfer.effectAllowed = 'copy';
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
			};

			scheduleBtn.ondragend = () => {
				card.style.opacity = '1';
			};

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
		// colums amount - only apply in grid view
		chrome.storage.sync.get({ columnCount: 3, viewMode: 'grid' }, ({ columnCount, viewMode }) => {
			if (viewMode === 'grid') {
				document.documentElement.style.setProperty('--jct-columns', columnCount);
			}
		});


		// After ensuring cards, reorder each grid container in a guarded way
		isReordering = true;
		try {
			document.querySelectorAll('.jct-courses-grid').forEach(reorderContainerByFavorites);
			document.querySelectorAll('.jct-carousel-container').forEach(reorderContainerByFavorites);
		}
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

		// Skip if children are semester groups - we don't want to reorder semesters
		if (children.some(el => el.classList.contains('jct-semester-group'))) {
			return; // This container has semester groups, don't reorder it
		}

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
		// Only show schedule on main page
		const body = document.body;
		if (!body || body.id !== 'page-site-index') return null;

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
		toggleBtn.innerHTML = scheduleViewVisible ? '✕ סגור לוח זמנים' : '📅 לוח זמנים שבועי';
		toggleBtn.addEventListener('click', () => {
			scheduleViewVisible = !scheduleViewVisible;
			const container = document.getElementById('jct-weekly-schedule');
			if (container) {
				container.style.display = scheduleViewVisible ? 'block' : 'none';
				toggleBtn.innerHTML = scheduleViewVisible ? '✕ סגור לוח זמנים' : '📅 לוח זמנים שבועי';
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

		// Insert toggle button and schedule before "My Courses" heading
		const coursesHeading = region.querySelector('#frontpage-course-list h2');
		if (coursesHeading && coursesHeading.parentElement) {
			// Insert button first, then schedule after it (so schedule is after button but both before heading)
			coursesHeading.parentElement.insertBefore(scheduleContainer, coursesHeading);
			coursesHeading.parentElement.insertBefore(toggleBtn, scheduleContainer);
		} else {
			// Fallback: Insert before courses grid
			const coursesGrid = region.querySelector('.jct-courses-grid');
			if (coursesGrid && coursesGrid.parentElement) {
				coursesGrid.parentElement.insertBefore(scheduleContainer, coursesGrid);
				coursesGrid.parentElement.insertBefore(toggleBtn, scheduleContainer);
			} else {
				region.insertBefore(scheduleContainer, region.firstChild);
				region.insertBefore(toggleBtn, region.firstChild);
			}
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
						? `<div class="jct-session-time">${sessionData.endTime} - ${sessionData.startTime}</div>`
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
					console.log('Drop received - raw data:', dataStr);

					if (!dataStr || dataStr === 'null') {
						console.log('No data received in drop');
						return;
					}

					const data = JSON.parse(dataStr);
					const dayKey = column.getAttribute('data-day');

					console.log('Drop parsed:', { data, dayKey });

					if (!data.courseId || !dayKey) {
						console.log('Missing courseId or dayKey:', { courseId: data.courseId, dayKey });
						return;
					}

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

			let scrollInterval = null;

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

			card.addEventListener('drag', (e) => {
				// Auto-scroll when dragging near edges
				const scrollThreshold = 80; // Distance from edge to trigger scroll
				const scrollSpeed = 15; // Pixels to scroll per interval

				if (e.clientY > 0 && e.clientY < window.innerHeight) {
					// Clear any existing scroll interval
					if (scrollInterval) {
						clearInterval(scrollInterval);
						scrollInterval = null;
					}

					// Check if near top edge
					if (e.clientY < scrollThreshold) {
						scrollInterval = setInterval(() => {
							window.scrollBy(0, -scrollSpeed);
						}, 20);
					}
					// Check if near bottom edge
					else if (e.clientY > window.innerHeight - scrollThreshold) {
						scrollInterval = setInterval(() => {
							window.scrollBy(0, scrollSpeed);
						}, 20);
					}
				}
			});

			card.addEventListener('dragend', () => {
				card.style.opacity = '1';
				// Clear scroll interval when drag ends
				if (scrollInterval) {
					clearInterval(scrollInterval);
					scrollInterval = null;
				}
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
	async function getAssignmentDueDate(assignmentUrl, assignmentId, forceRefresh = false) {
		// Check cache first (unless force refresh)
		if (!forceRefresh) {
			const cache = await getDueDateCache();
			if (cache[assignmentId] !== undefined) {
				return cache[assignmentId] ? new Date(cache[assignmentId]) : null;
			}
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

	// Function to get assignment submission status (cache only, no fetch)
	async function getAssignmentSubmissionStatus(assignmentUrl, assignmentId, forceRefresh = false) {
		if (!assignmentUrl) return null;

		// Check cache first
		const cacheKey = `submission_status_${assignmentId}`;
		try {
			const cached = await new Promise(resolve => {
				chrome.storage.local.get({ submissionStatusCache: {} }, res => {
					const cache = res.submissionStatusCache || {};
					resolve(cache[cacheKey]);
				});
			});

			if (cached && cached.timestamp) {
				const age = Date.now() - cached.timestamp;
				const oneWeek = 7 * 24 * 60 * 60 * 1000;
				if (age < oneWeek) {
					return cached.status;
				}
			}
		} catch (e) {
			console.error('Error reading submission status cache:', e);
		}

		// Only fetch if explicitly requested (forceRefresh = true)
		if (!forceRefresh) {
			return null;
		}

		// Fetch the assignment page
		try {
			const response = await fetch(assignmentUrl, {
				method: 'GET',
				credentials: 'include'
			});

			if (!response.ok) return null;

			const html = await response.text();
			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');

			// Find the submission status in the table - try multiple selectors
			let statusRow = Array.from(doc.querySelectorAll('table.generaltable tr')).find(row => {
				const th = row.querySelector('th');
				return th && th.textContent.includes('מצב ההגשה');
			});

			// If not found, try all tables
			if (!statusRow) {
				statusRow = Array.from(doc.querySelectorAll('table tr')).find(row => {
					const th = row.querySelector('th');
					return th && th.textContent.includes('מצב ההגשה');
				});
			}

			if (statusRow) {
				const statusCell = statusRow.querySelector('td');
				if (statusCell) {
					const statusText = statusCell.textContent.trim();

					let status = 'not_submitted';
					// Check both text content and CSS classes
					if (statusText.includes('הוגש למתן ציון') || statusText.includes('הוגש') ||
						statusCell.classList.contains('submissionstatussubmitted') ||
						statusCell.className.includes('submitted')) {
						status = 'submitted';
					} else if (statusText.includes('אין עדיין הגשות')) {
						status = 'not_submitted';
					}

					// Cache the result
					try {
						await new Promise(resolve => {
							chrome.storage.local.get({ submissionStatusCache: {} }, res => {
								const cache = res.submissionStatusCache || {};
								cache[cacheKey] = {
									status: status,
									timestamp: Date.now()
								};
								chrome.storage.local.set({ submissionStatusCache: cache }, () => resolve());
							});
						});
					} catch (e) {
						console.error('Error saving submission status cache:', e);
					}

					return status;
				}
			}

			return null;
		} catch (error) {
			console.error('Error fetching submission status:', error);
			return null;
		}
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
				// Parse year and semester from course name
				const { year, semIdx } = parseHebrewYearAndSemester(courseName);

				// Check year filter (required)
				if (year !== parseInt(filterYear)) {
					return false;
				}

				// Check semester filter (required)
				if (semIdx !== parseInt(filterSemester)) {
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
						// AND also: <a href="https://moodle.jct.ac.il/course/view.php?id=73462&section=1#tabs-tree-start">
						const sectionLinks = doc.querySelectorAll('a[href*="/course/section.php"]');
						const tabSectionLinks = doc.querySelectorAll('a[href*="/course/view.php"][href*="section="][href*="#tabs-tree-start"]');

						console.log(`Found ${sectionLinks.length} section.php links and ${tabSectionLinks.length} tab section links in ${courseName}`);

						// Combine both types of section links
						const allSectionLinks = [...sectionLinks, ...tabSectionLinks];

						// Step 2: Fetch each section and look for assignments inside
						for (const sectionLink of allSectionLinks) {
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
			{ str: "תשפ\"ד", num: 5784 }, { str: "תשפ\"ה", num: 5785 }, { str: "תשפ\"ו", num: 5786 },
			{ str: "תשפ\"ז", num: 5787 }, { str: "תשפ\"ח", num: 5788 }, { str: "תשפ\"ט", num: 5789 }, { str: "תש\"צ", num: 5790 }
		];
		const SEMESTERS = ["אלול", "א", "ב"];
		const DEFAULT_PALETTE = [
			["#3b82f6", "#818cf8", "#bae6fd"], // 5784
			["#22c55e", "#4ade80", "#bbf7d0"], // 5785
			["#f97316", "#fbbf24", "#fed7aa"], // 5786
			["#f43f5e", "#fda4af", "#fecdd3"], // 5787
			["#a21caf", "#f472b6", "#f3e8ff"], // 5788
			["#2563eb", "#60a5fa", "#dbeafe"], // 5789
			["#b45309", "#f59e42", "#fde68a"]  // 5790
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
			<div class="jct-assignments-modal-content" style="max-width: 1200px; width: 90vw;">
				<div class="jct-assignments-modal-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
					<h3 style="color: white; margin: 0;">⚙️ הגדרות</h3>
					<button class="jct-assignments-modal-close" style="color: white; opacity: 0.9;">✕</button>
				</div>
				<div class="jct-assignments-modal-body" style="padding: 32px;">
					<div style="display: grid; grid-template-columns: 2fr 1fr; gap: 32px; align-items: start;">
						<!-- Right side: Color palette -->
						<div>
							<h4 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1e293b;">🎨 צבעים לכל שנה וסמסטר</h4>
							<table style="border-collapse:collapse;background:#fff;width:100%;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;">
								${tableHtml}
							</table>
							<p style="color: #64748b; font-size: 13px; margin-top: 12px; line-height: 1.5;">
								💡 כל שנה היא שורה, כל סמסטר הוא עמודה. לחץ על צבע כדי לשנות.
							</p>
						</div>

						<!-- Left side: Settings -->
						<div style="background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); padding: 24px; border-radius: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
							<h4 style="margin: 0 0 20px; font-size: 18px; font-weight: 600; color: #1e293b;">⚡ הגדרות תצוגה</h4>

							<div style="margin-bottom: 20px;">
								<label style="display: block; margin-bottom: 8px; font-weight: 500; color: #334155; font-size: 14px;">
									תצוגת קורסים
								</label>
								<select id="jct-view-mode" style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 2px solid #cbd5e1; background: white; font-size: 14px; cursor: pointer; transition: all 0.2s;">
									<option value="grid" ${viewMode === 'grid' ? 'selected' : ''}>🔲 בלוקים</option>
									<option value="list" ${viewMode === 'list' ? 'selected' : ''}>📋 רשימה</option>
									<option value="original" ${viewMode === 'original' ? 'selected' : ''}>📄 מקורי</option>
									<option value="carousel" ${viewMode === 'carousel' ? 'selected' : ''}>🎠 קלפים</option>
								</select>
							</div>

							<div style="margin-bottom: 20px;">
								<label style="display: block; margin-bottom: 8px; font-weight: 500; color: #334155; font-size: 14px;">
									עיצוב כרטיסים
								</label>
								<select id="jct-card-style" style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 2px solid #cbd5e1; background: white; font-size: 14px; cursor: pointer; transition: all 0.2s;">
									<option value="compact" ${cardStyle === 'compact' ? 'selected' : ''}>📦 קומפקטי</option>
									<option value="minimal" ${cardStyle === 'minimal' ? 'selected' : ''}>✨ מינימליסטי</option>
									<option value="cards" ${cardStyle === 'cards' ? 'selected' : ''}>🎴 כרטיסים</option>
									<option value="modern" ${cardStyle === 'modern' ? 'selected' : ''}>🚀 מודרני</option>
									<option value="glass" ${cardStyle === 'glass' ? 'selected' : ''}>💎 זכוכית</option>
								</select>
							</div>

							<div style="margin-bottom: 24px;">
								<label style="display: block; margin-bottom: 8px; font-weight: 500; color: #334155; font-size: 14px;">
									מספר עמודות בתצוגת בלוקים
								</label>
								<input id="jct-column-count" type="number" min="3" max="6" step="1" value="${columnCount}"
									style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 2px solid #cbd5e1; background: white; font-size: 14px;">
								<span style="display: block; margin-top: 6px; font-size: 12px; color: #64748b;">טווח: 3-6 עמודות</span>
							</div>

							<div style="margin-top: 28px; display: flex; flex-direction: column; gap: 10px;">
								<button id="jct-settings-save" style="padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 15px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); transition: all 0.2s;">
									💾 שמור שינויים
								</button>
								<button id="jct-settings-reset" style="padding: 10px 20px; background: white; color: #475569; border: 2px solid #cbd5e1; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s;">
									🔄 איפוס לברירת מחדל
								</button>
							</div>
						</div>
					</div>
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

		// Add hover effects to buttons
		const saveBtn = document.getElementById('jct-settings-save');
		const resetBtn = document.getElementById('jct-settings-reset');

		saveBtn.addEventListener('mouseenter', () => {
			saveBtn.style.transform = 'translateY(-2px)';
			saveBtn.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.5)';
		});
		saveBtn.addEventListener('mouseleave', () => {
			saveBtn.style.transform = 'translateY(0)';
			saveBtn.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
		});

		resetBtn.addEventListener('mouseenter', () => {
			resetBtn.style.background = '#f1f5f9';
			resetBtn.style.borderColor = '#94a3b8';
		});
		resetBtn.addEventListener('mouseleave', () => {
			resetBtn.style.background = 'white';
			resetBtn.style.borderColor = '#cbd5e1';
		});

		// Add hover effects to select elements
		const viewModeSelect = document.getElementById('jct-view-mode');
		const cardStyleSelect = document.getElementById('jct-card-style');

		[viewModeSelect, cardStyleSelect].forEach(select => {
			select.addEventListener('mouseenter', () => {
				select.style.borderColor = '#667eea';
			});
			select.addEventListener('mouseleave', () => {
				select.style.borderColor = '#cbd5e1';
			});
		});
	}

	// Function to refresh today's events block
	async function refreshTodayEventsBlock() {
		const existingBlock = document.getElementById('jct-today-events-block');
		if (existingBlock) {
			// Find the button container
			const buttonContainer = document.querySelector('.jct-action-buttons-container');
			if (buttonContainer) {
				existingBlock.remove();
				await showTodayEventsBlock(buttonContainer);
			}
		}
	}

	// Function to show today's events block below calendar button
	async function showTodayEventsBlock(buttonElement) {
		// Get today's date
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

		// Get custom events from storage
		const customEvents = await new Promise(resolve => {
			chrome.storage.local.get({ customEvents: [] }, res => {
				resolve(res.customEvents || []);
			});
		});

		// Get assignments from cache
		const cache = await new Promise(resolve => {
			chrome.storage.local.get({ assignmentScanResults: null }, res => {
				resolve(res.assignmentScanResults);
			});
		});

		// Get due date cache
		const dueDateCacheData = await new Promise(resolve => {
			chrome.storage.local.get({ dueDateCache: {} }, res => {
				resolve(res.dueDateCache || {});
			});
		});

		// Get submission status cache
		const submissionStatusCache = await new Promise(resolve => {
			chrome.storage.local.get({ submissionStatusCache: {} }, res => {
				resolve(res.submissionStatusCache || {});
			});
		});

		// Collect today's events
		const todayEvents = [];

		// Add assignments due today
		if (cache && cache.assignments && Array.isArray(cache.assignments)) {
			cache.assignments.forEach(assignment => {
				const dueDateTimestamp = dueDateCacheData[assignment.assignmentId];
				if (dueDateTimestamp) {
					const dueDate = new Date(dueDateTimestamp * 1000);
					dueDate.setHours(0, 0, 0, 0);

					if (dueDate.getTime() === today.getTime()) {
						const submissionStatus = submissionStatusCache[assignment.assignmentId] || 'unknown';
						todayEvents.push({
							type: 'assignment',
							title: assignment.assignmentName,
							courseName: assignment.courseName,
							url: assignment.assignmentUrl,
							dueDate: new Date(dueDateTimestamp * 1000),
							submissionStatus: submissionStatus
						});
					}
				}
			});
		}

		// Add custom events for today
		customEvents.forEach(event => {
			const eventDate = new Date(event.date);
			eventDate.setHours(0, 0, 0, 0);

			if (eventDate.getTime() === today.getTime()) {
				todayEvents.push({
					type: 'custom',
					title: event.title,
					description: event.description || '',
					time: event.time || ''
				});
			}
		});

		// Sort events by time/priority
		todayEvents.sort((a, b) => {
			if (a.type === 'assignment' && b.type === 'custom') return -1;
			if (a.type === 'custom' && b.type === 'assignment') return 1;
			return 0;
		});

		// Create the events block
		const eventsBlock = document.createElement('div');
		eventsBlock.id = 'jct-today-events-block';
		eventsBlock.className = 'jct-today-events-block';

		const todayStr = today.toLocaleDateString('he-IL', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});

		let html = `
			<div class="jct-today-events-header">
				<h3>📅 אירועי היום - ${todayStr}</h3>
			</div>
			<div class="jct-today-events-list">
		`;

		if (todayEvents.length === 0) {
			html += `
				<div class="jct-no-events">
					<p>🎉 אין אירועים להיום!</p>
					<p style="font-size: 0.875rem; color: #64748b; margin-top: 8px;">תהנה מיום רגוע</p>
				</div>
			`;
		} else {
			todayEvents.forEach(event => {
				if (event.type === 'assignment') {
					const isSubmitted = event.submissionStatus === 'submitted';
					const statusColor = isSubmitted ? '#16a34a' : '#dc2626';
					const statusIcon = isSubmitted ? '✓' : '✗';
					const statusText = isSubmitted ? 'הוגש' : 'לא הוגש';

					html += `
						<div class="jct-today-event-item assignment" style="border-right: 4px solid ${statusColor};">
							<div class="jct-event-icon">📝</div>
							<div class="jct-event-content">
								<h4>${event.title}</h4>
								<p class="jct-event-course">${event.courseName}</p>
								<div class="jct-event-meta">
									<span class="jct-event-status" style="color: ${statusColor};">
										${statusIcon} ${statusText}
									</span>
								</div>
							</div>
							<a href="${event.url}" class="jct-event-link" target="_blank">פתח →</a>
						</div>
					`;
				} else {
					html += `
						<div class="jct-today-event-item custom">
							<div class="jct-event-icon">🎯</div>
							<div class="jct-event-content">
								<h4>${event.title}</h4>
								${event.description ? `<p class="jct-event-description">${event.description}</p>` : ''}
								${event.time ? `<p class="jct-event-time">🕐 ${event.time}</p>` : ''}
							</div>
						</div>
					`;
				}
			});
		}

		html += `</div>`;
		eventsBlock.innerHTML = html;

		// Insert the block inside the button container (grid layout)
		const buttonContainer = document.querySelector('.jct-action-buttons-container');
		if (buttonContainer) {
			buttonContainer.appendChild(eventsBlock);
		} else if (buttonElement && buttonElement.parentElement) {
			buttonElement.parentElement.insertBefore(eventsBlock, buttonElement.nextSibling);
		}
	}

	// Function to show calendar view with assignments and custom events
	async function showCalendarModal() {
		// Get custom events from storage
		const customEvents = await new Promise(resolve => {
			chrome.storage.local.get({ customEvents: [] }, res => {
				resolve(res.customEvents || []);
			});
		});

		// Get current month/year
		let currentDate = new Date();
		let currentMonth = currentDate.getMonth();
		let currentYear = currentDate.getFullYear();

		// Hebrew month names
		const hebrewMonths = [
			'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
			'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
		];

		// Create modal
		const modal = document.createElement('div');
		modal.className = 'jct-calendar-modal';
		modal.innerHTML = `
			<div class="jct-calendar-modal-content" style="max-width: 95vw; max-height: 95vh; width: 1100px; display: flex; flex-direction: column;">
				<div class="jct-calendar-modal-header">
					<h3>לוח שנה - מטלות ואירועים</h3>
					<button class="jct-calendar-modal-close">✕</button>
				</div>
				<div class="jct-calendar-controls" style="padding: 8px 12px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;">
					<button id="jct-cal-prev" style="padding: 4px 10px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 0.8rem;">→ קודם</button>
					<h4 id="jct-cal-month-year" style="margin: 0; font-size: 0.95rem;"></h4>
					<button id="jct-cal-next" style="padding: 4px 10px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 0.8rem;">הבא ←</button>
				</div>
				<div class="jct-calendar-body" id="jct-calendar-grid" style="padding: 8px; overflow-y: auto; flex: 1;">
					<!-- Calendar grid will be inserted here -->
				</div>
				<div style="padding: 12px; background: #f8fafc; border-top: 1px solid #e5e7eb; display: flex; justify-content: center;">
					<button id="jct-add-event-btn" style="padding: 10px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 0.9rem; box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4); transition: all 0.2s ease;">
						➕ הוסף אירוע חדש
					</button>
				</div>
			</div>
		`;
		document.body.appendChild(modal);

		// Close button
		modal.querySelector('.jct-calendar-modal-close').addEventListener('click', () => {
			modal.remove();
		});

		// Click outside to close
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.remove();
			}
		});

		// Function to render calendar
		async function renderCalendar() {
			const grid = document.getElementById('jct-calendar-grid');
			const monthYearLabel = document.getElementById('jct-cal-month-year');

			monthYearLabel.textContent = `${hebrewMonths[currentMonth]} ${currentYear}`;

			// Get first day of month and number of days
			const firstDay = new Date(currentYear, currentMonth, 1);
			const lastDay = new Date(currentYear, currentMonth + 1, 0);
			const numDays = lastDay.getDate();
			const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday

			// Get assignments from cache
			const { cache } = await getAssignmentsCache();
			const allAssignments = [];

			// Get due date cache and submission status cache
			const dueDateCacheData = await new Promise(resolve => {
				chrome.storage.local.get({ dueDateCache: {} }, res => {
					resolve(res.dueDateCache || {});
				});
			});

			const submissionStatusCache = await new Promise(resolve => {
				chrome.storage.local.get({ submissionStatusCache: {} }, res => {
					resolve(res.submissionStatusCache || {});
				});
			});

			console.log('[JCT Calendar] Cache data:', cache);
			console.log('[JCT Calendar] Due date cache:', dueDateCacheData);
			console.log('[JCT Calendar] Submission status cache:', submissionStatusCache);

			// Check if cache has the new format with assignments array
			if (cache && cache.assignments && Array.isArray(cache.assignments)) {
				console.log('[JCT Calendar] Processing', cache.assignments.length, 'assignments from cache');
				cache.assignments.forEach(assignment => {
					// Get due date from due date cache (key is just the assignmentId)
					const dueDateTimestamp = dueDateCacheData[assignment.assignmentId];

					if (dueDateTimestamp) {
						const dueDate = new Date(dueDateTimestamp);

						// Skip invalid dates
						if (isNaN(dueDate.getTime())) {
							console.log('[JCT Calendar] Invalid date for assignment:', assignment);
							return;
						}

						// Get submission status
						const statusCacheKey = `submission_status_${assignment.assignmentId}`;
						const cachedStatus = submissionStatusCache[statusCacheKey];
						const submissionStatus = cachedStatus ? cachedStatus.status : null;

						allAssignments.push({
							...assignment,
							dueDate,
							submissionStatus,
							type: 'assignment'
						});
					}
				});
			}
			// Fallback for old format (array of courses)
			else if (cache && Array.isArray(cache)) {
				for (const courseData of cache) {
					if (courseData && courseData.assignments && Array.isArray(courseData.assignments)) {
						courseData.assignments.forEach(assignment => {
							// Get due date from due date cache (key is just the assignmentId)
							const dueDateTimestamp = dueDateCacheData[assignment.assignmentId];

							if (dueDateTimestamp) {
								const dueDate = new Date(dueDateTimestamp);

								// Skip invalid dates
								if (isNaN(dueDate.getTime())) {
									console.log('[JCT Calendar] Invalid date for assignment:', assignment);
									return;
								}

								// Get submission status
								const statusCacheKey = `submission_status_${assignment.assignmentId}`;
								const cachedStatus = submissionStatusCache[statusCacheKey];
								const submissionStatus = cachedStatus ? cachedStatus.status : null;

								allAssignments.push({
									...assignment,
									dueDate,
									submissionStatus,
									courseName: courseData.courseName,
									type: 'assignment'
								});
							}
						});
					}
				}
			}

			console.log('[JCT Calendar] Found assignments:', allAssignments.length, allAssignments);

			// Combine with custom events
			const allEvents = [...allAssignments];
			customEvents.forEach(event => {
				allEvents.push({
					...event,
					dueDate: new Date(event.date),
					type: 'custom'
				});
			});

			console.log('[JCT Calendar] Total events (assignments + custom):', allEvents.length);

			// Create calendar grid
			let html = `
				<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 6px;">
					<div style="text-align: center; font-weight: 600; padding: 4px; background: #e0e7ff; border-radius: 4px; font-size: 0.75rem;">ראשון</div>
					<div style="text-align: center; font-weight: 600; padding: 4px; background: #e0e7ff; border-radius: 4px; font-size: 0.75rem;">שני</div>
					<div style="text-align: center; font-weight: 600; padding: 4px; background: #e0e7ff; border-radius: 4px; font-size: 0.75rem;">שלישי</div>
					<div style="text-align: center; font-weight: 600; padding: 4px; background: #e0e7ff; border-radius: 4px; font-size: 0.75rem;">רביעי</div>
					<div style="text-align: center; font-weight: 600; padding: 4px; background: #e0e7ff; border-radius: 4px; font-size: 0.75rem;">חמישי</div>
					<div style="text-align: center; font-weight: 600; padding: 4px; background: #e0e7ff; border-radius: 4px; font-size: 0.75rem;">שישי</div>
					<div style="text-align: center; font-weight: 600; padding: 4px; background: #e0e7ff; border-radius: 4px; font-size: 0.75rem;">שבת</div>
				</div>
				<div style="display: grid; grid-template-columns: repeat(7, 1fr); grid-auto-rows: 1fr; gap: 4px;">
			`;

			// Add empty cells for days before the 1st
			for (let i = 0; i < startingDayOfWeek; i++) {
				html += `<div style="aspect-ratio: 1/1; background: #f8fafc; border-radius: 3px; border: 1px solid #e5e7eb;"></div>`;
			}

			// Add days of the month
			for (let day = 1; day <= numDays; day++) {
				const currentDateObj = new Date(currentYear, currentMonth, day);
				const isToday = currentDateObj.toDateString() === new Date().toDateString();

				// Find events for this day
				const dayEvents = allEvents.filter(event => {
					const eventDate = event.dueDate;
					return eventDate.getDate() === day &&
						eventDate.getMonth() === currentMonth &&
						eventDate.getFullYear() === currentYear;
				});

				if (dayEvents.length > 0) {
					console.log(`[JCT Calendar] Day ${day}: ${dayEvents.length} events`, dayEvents);
				}

				const bgColor = isToday ? '#dbeafe' : '#ffffff';
				const borderColor = isToday ? '#3b82f6' : '#e5e7eb';
				const hasEvents = dayEvents.length > 0;

				html += `
					<div class="jct-calendar-day ${hasEvents ? 'has-events' : ''}" data-day="${day}" data-month="${currentMonth}" data-year="${currentYear}" style="aspect-ratio: 1/1; background: ${bgColor}; border-radius: 4px; border: 1px solid ${borderColor}; padding: 4px; position: relative; cursor: ${hasEvents ? 'pointer' : 'default'}; overflow: hidden; display: flex; flex-direction: column;">
						<div style="font-weight: 600; margin-bottom: 2px; color: ${isToday ? '#1e40af' : '#1f2937'}; flex-shrink: 0; font-size: 0.7rem;">${day}</div>
						<div style="font-size: 0.5rem; overflow: hidden; flex: 1; display: flex; flex-direction: column; gap: 1px;">
				`;

				// Show only count of events (limit to 3 badges)
				const displayEvents = dayEvents.slice(0, 3);
				displayEvents.forEach(event => {
					if (event.type === 'assignment') {
						const now = new Date();
						const isOverdue = event.dueDate < now;
						const isSubmitted = event.submissionStatus === 'submitted';

						// Color logic:
						// - הוגש (submitted) = ירוק (green) - לא משנה אם באיחור
						// - לא הוגש + באיחור = צהוב (yellow)
						// - לא הוגש + לא באיחור = כחול (blue)
						let color;
						let statusIcon = '';
						if (isSubmitted) {
							color = '#16a34a'; // green
							statusIcon = '✓';
						} else if (isOverdue) {
							color = '#eab308'; // yellow
							statusIcon = '✗';
						} else {
							color = '#2563eb'; // blue
							statusIcon = event.submissionStatus === 'not_submitted' ? '✗' : '';
						}

						html += `
							<div style="background: ${color}; color: white; padding: 2px 4px; border-radius: 3px; font-size: 0.65rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; line-height: 1.3;">
								${statusIcon} ${event.assignmentName.substring(0, 12)}${event.assignmentName.length > 12 ? '..' : ''}
							</div>
						`;
					} else {
						html += `
							<div style="background: #22c55e; color: white; padding: 2px 4px; border-radius: 3px; font-size: 0.65rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; line-height: 1.3;">
								${event.title.substring(0, 12)}${event.title.length > 12 ? '..' : ''}
							</div>
						`;
					}
				});

				// Show "+X more" if there are more events
				if (dayEvents.length > 3) {
					html += `
						<div style="font-size: 0.48rem; color: #64748b; text-align: center; margin-top: 1px; flex-shrink: 0;">
							+${dayEvents.length - 3}
						</div>
					`;
				}

				html += `
						</div>
					</div>
				`;
			}

			html += `</div>`;
			grid.innerHTML = html;

			// Add click listeners to calendar days with events
			grid.querySelectorAll('.jct-calendar-day.has-events').forEach(dayEl => {
				dayEl.addEventListener('click', (e) => {
					// Don't trigger if clicking on a delete button
					if (e.target.classList.contains('jct-delete-event')) return;

					const day = parseInt(dayEl.dataset.day);
					const month = parseInt(dayEl.dataset.month);
					const year = parseInt(dayEl.dataset.year);

					// Get events for this day
					const dayEvents = allEvents.filter(event => {
						const eventDate = event.dueDate;
						return eventDate.getDate() === day &&
							eventDate.getMonth() === month &&
							eventDate.getFullYear() === year;
					});

					showDayDetailsModal(day, month, year, dayEvents);
				});
			});
		}

		// Function to show day details modal
		function showDayDetailsModal(day, month, year, dayEvents) {
			const hebrewMonths = [
				'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
				'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
			];

			const detailsModal = document.createElement('div');
			detailsModal.className = 'jct-day-details-modal';
			detailsModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100002;';

			let eventsHtml = '';
			dayEvents.forEach(event => {
				if (event.type === 'assignment') {
					const now = new Date();
					const isOverdue = event.dueDate < now;
					const isSubmitted = event.submissionStatus === 'submitted';

					let statusBadge;
					if (isSubmitted) {
						statusBadge = '<span style="background: #16a34a; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-right: 8px;">✓ הוגש</span>';
					} else if (isOverdue) {
						statusBadge = '<span style="background: #eab308; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-right: 8px;">✗ לא הוגש (באיחור)</span>';
					} else {
						statusBadge = event.submissionStatus === 'not_submitted'
							? '<span style="background: #2563eb; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; margin-right: 8px;">✗ לא הוגש</span>'
							: '';
					}

					const overdueText = isOverdue && !isSubmitted ? '<span style="color: #eab308; font-weight: 600;">(באיחור)</span>' : '';

					eventsHtml += `
						<div style="background: #f8fafc; padding: 16px; border-radius: 8px; border-right: 4px solid ${event.submissionStatus === 'submitted' ? '#16a34a' : (isOverdue ? '#eab308' : '#2563eb')}; margin-bottom: 12px;">
							<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
								<h4 style="margin: 0; font-size: 1rem; color: #1f2937;">📝 ${event.assignmentName}</h4>
								${statusBadge}
							</div>
							<div style="font-size: 0.875rem; color: #64748b; margin-bottom: 4px;">
								<strong>קורס:</strong> ${event.courseName}
							</div>
							<div style="font-size: 0.875rem; color: #64748b; margin-bottom: 8px;">
								<strong>תאריך יעד:</strong> ${event.dueDate.toLocaleDateString('he-IL')} ${event.dueDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} ${overdueText}
							</div>
							<a href="${event.assignmentUrl}" target="_blank" style="display: inline-block; background: #2563eb; color: white; padding: 6px 12px; border-radius: 6px; text-decoration: none; font-size: 0.875rem;">
								פתח מטלה
							</a>
						</div>
					`;
				} else {
					eventsHtml += `
						<div style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-right: 4px solid #22c55e; margin-bottom: 12px;">
							<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
								<h4 style="margin: 0; font-size: 1rem; color: #1f2937;">${event.title}</h4>
								<div>
									<button class="jct-edit-event-btn" data-event-id="${event.id}" style="background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; margin-left: 4px; font-size: 0.75rem;">ערוך</button>
									<button class="jct-delete-event-btn" data-event-id="${event.id}" style="background: #dc2626; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">מחק</button>
								</div>
							</div>
							${event.description ? `<div style="font-size: 0.875rem; color: #64748b; margin-bottom: 4px;">${event.description}</div>` : ''}
							<div style="font-size: 0.875rem; color: #64748b;">
								<strong>תאריך:</strong> ${new Date(event.date).toLocaleDateString('he-IL')}
							</div>
						</div>
					`;
				}
			});

			detailsModal.innerHTML = `
				<div style="background: white; padding: 24px; border-radius: 12px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;">
					<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid #e5e7eb;">
						<h3 style="margin: 0; font-size: 1.5rem; color: #1f2937;">${day} ${hebrewMonths[month]} ${year}</h3>
						<button class="jct-close-details" style="background: #ef4444; color: white; border: none; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.25rem;">✕</button>
					</div>
					<div style="font-size: 0.875rem; color: #64748b; margin-bottom: 16px;">
						סה"כ ${dayEvents.length} ${dayEvents.length === 1 ? 'אירוע' : 'אירועים'}
					</div>
					${eventsHtml}
				</div>
			`;

			document.body.appendChild(detailsModal);

			// Close button
			detailsModal.querySelector('.jct-close-details').addEventListener('click', () => {
				detailsModal.remove();
			});

			// Click outside to close
			detailsModal.addEventListener('click', (e) => {
				if (e.target === detailsModal) {
					detailsModal.remove();
				}
			});

			// Edit custom event buttons
			detailsModal.querySelectorAll('.jct-edit-event-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					const eventId = btn.dataset.eventId;
					detailsModal.remove();
					editCustomEvent(eventId);
				});
			});

			// Delete custom event buttons
			detailsModal.querySelectorAll('.jct-delete-event-btn').forEach(btn => {
				btn.addEventListener('click', async () => {
					const eventId = btn.dataset.eventId;
					if (confirm('האם אתה בטוח שברצונך למחוק אירוע זה?')) {
						const index = customEvents.findIndex(ev => ev.id === eventId);
						if (index !== -1) {
							customEvents.splice(index, 1);
							await new Promise(resolve => {
								chrome.storage.local.set({ customEvents }, () => resolve());
							});
							detailsModal.remove();
							renderCalendar();

							// Refresh today's events block
							refreshTodayEventsBlock();
						}
					}
				});
			});
		}

		// Function to add custom event
		function addCustomEvent() {
			const eventModal = document.createElement('div');
			eventModal.className = 'jct-event-edit-modal';
			eventModal.innerHTML = `
				<div class="jct-event-edit-content" style="background: white; padding: 24px; border-radius: 12px; max-width: 500px; width: 90%;">
					<h3 style="margin-top: 0;">הוסף אירוע חדש</h3>
					<div style="margin-bottom: 16px;">
						<label style="display: block; margin-bottom: 4px; font-weight: 500;">שם האירוע:</label>
						<input type="text" id="jct-event-title" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px;" placeholder="לדוגמה: פגישה עם מרצה">
					</div>
					<div style="margin-bottom: 16px;">
						<label style="display: block; margin-bottom: 4px; font-weight: 500;">תאריך:</label>
						<input type="date" id="jct-event-date" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px;">
					</div>
					<div style="margin-bottom: 16px;">
						<label style="display: block; margin-bottom: 4px; font-weight: 500;">תיאור (אופציונלי):</label>
						<textarea id="jct-event-description" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; min-height: 80px;" placeholder="תיאור האירוע..."></textarea>
					</div>
					<div style="display: flex; gap: 12px; justify-content: flex-end;">
						<button id="jct-event-cancel" style="padding: 8px 16px; background: #94a3b8; color: white; border: none; border-radius: 6px; cursor: pointer;">ביטול</button>
						<button id="jct-event-save" style="padding: 8px 16px; background: #22c55e; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">שמור</button>
					</div>
				</div>
			`;
			eventModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100001;';
			document.body.appendChild(eventModal);

			// Set default date to today
			const today = new Date().toISOString().split('T')[0];
			document.getElementById('jct-event-date').value = today;

			// Cancel button
			document.getElementById('jct-event-cancel').addEventListener('click', () => {
				eventModal.remove();
			});

			// Save button
			document.getElementById('jct-event-save').addEventListener('click', async () => {
				const title = document.getElementById('jct-event-title').value.trim();
				const date = document.getElementById('jct-event-date').value;
				const description = document.getElementById('jct-event-description').value.trim();

				if (!title || !date) {
					alert('נא למלא שם ותאריך לאירוע');
					return;
				}

				// Create new event
				const newEvent = {
					id: Date.now().toString(),
					title,
					date,
					description
				};

				customEvents.push(newEvent);

				// Save to storage
				await new Promise(resolve => {
					chrome.storage.local.set({ customEvents }, () => resolve());
				});

				eventModal.remove();
				renderCalendar();

				// Refresh today's events block
				refreshTodayEventsBlock();
			});

			// Click outside to close
			eventModal.addEventListener('click', (e) => {
				if (e.target === eventModal) {
					eventModal.remove();
				}
			});
		}

		// Function to edit custom event
		function editCustomEvent(eventId) {
			const event = customEvents.find(ev => ev.id === eventId);
			if (!event) return;

			const eventModal = document.createElement('div');
			eventModal.className = 'jct-event-edit-modal';
			eventModal.innerHTML = `
				<div class="jct-event-edit-content" style="background: white; padding: 24px; border-radius: 12px; max-width: 500px; width: 90%;">
					<h3 style="margin-top: 0;">ערוך אירוע</h3>
					<div style="margin-bottom: 16px;">
						<label style="display: block; margin-bottom: 4px; font-weight: 500;">שם האירוע:</label>
						<input type="text" id="jct-event-title" value="${event.title}" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px;">
					</div>
					<div style="margin-bottom: 16px;">
						<label style="display: block; margin-bottom: 4px; font-weight: 500;">תאריך:</label>
						<input type="date" id="jct-event-date" value="${event.date}" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px;">
					</div>
					<div style="margin-bottom: 16px;">
						<label style="display: block; margin-bottom: 4px; font-weight: 500;">תיאור (אופציונלי):</label>
						<textarea id="jct-event-description" style="width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; min-height: 80px;">${event.description || ''}</textarea>
					</div>
					<div style="display: flex; gap: 12px; justify-content: flex-end;">
						<button id="jct-event-cancel" style="padding: 8px 16px; background: #94a3b8; color: white; border: none; border-radius: 6px; cursor: pointer;">ביטול</button>
						<button id="jct-event-save" style="padding: 8px 16px; background: #22c55e; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">שמור</button>
					</div>
				</div>
			`;
			eventModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100001;';
			document.body.appendChild(eventModal);

			// Cancel button
			document.getElementById('jct-event-cancel').addEventListener('click', () => {
				eventModal.remove();
			});

			// Save button
			document.getElementById('jct-event-save').addEventListener('click', async () => {
				const title = document.getElementById('jct-event-title').value.trim();
				const date = document.getElementById('jct-event-date').value;
				const description = document.getElementById('jct-event-description').value.trim();

				if (!title || !date) {
					alert('נא למלא שם ותאריך לאירוע');
					return;
				}

				// Update event
				event.title = title;
				event.date = date;
				event.description = description;

				// Save to storage
				await new Promise(resolve => {
					chrome.storage.local.set({ customEvents }, () => resolve());
				});

				eventModal.remove();
				renderCalendar();

				// Refresh today's events block
				refreshTodayEventsBlock();
			});

			// Click outside to close
			eventModal.addEventListener('click', (e) => {
				if (e.target === eventModal) {
					eventModal.remove();
				}
			});
		}

		// Navigation buttons
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

		// Add event button
		const addEventBtn = document.getElementById('jct-add-event-btn');
		addEventBtn.addEventListener('click', () => {
			addCustomEvent();
		});

		// Add hover effect
		addEventBtn.addEventListener('mouseenter', () => {
			addEventBtn.style.transform = 'translateY(-2px)';
			addEventBtn.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.5)';
		});
		addEventBtn.addEventListener('mouseleave', () => {
			addEventBtn.style.transform = 'translateY(0)';
			addEventBtn.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.4)';
		});

		// Initial render
		renderCalendar();
	}

	// Global flag to track if we've already done a status refresh in current modal session
	let hasRefreshedStatusGlobal = false;
	let isModalOpening = false;

	// Function to show all assignments in a modal
	async function showAllAssignmentsModal() {
		// Prevent opening multiple modals
		if (document.querySelector('.jct-assignments-modal') || isModalOpening) {
			return;
		}
		isModalOpening = true;
		// Get settings including filter preferences
		const settings = await new Promise(resolve => {
			chrome.storage.sync.get({
				maxOverdueDays: 30,
				assignmentFilterYear: '',
				assignmentFilterSemester: ''
			}, res => resolve(res));
		});
		const maxOverdueDays = settings.maxOverdueDays !== undefined ? settings.maxOverdueDays : 30;
		const savedFilterYear = settings.assignmentFilterYear || '';
		const savedFilterSemester = settings.assignmentFilterSemester || '';
		const hideSubmitted = settings.hideSubmittedAssignments !== undefined ? settings.hideSubmittedAssignments : false;

		// Create modal with live results
		const modal = document.createElement('div');
		modal.className = 'jct-assignments-modal';
		modal.innerHTML = `
			<div class="jct-assignments-modal-content jct-assignments-modal-large">
				<div class="jct-assignments-modal-header">
					<h3 id="jct-modal-title">טוען קורסים...</h3>
					<div id="jct-scanning-notice" style="display: none;">
						⏳ סורק... נא להמתין
					</div>
					<button class="jct-assignments-modal-close">✕</button>
				</div>
				<div class="jct-filter-controls" style="padding: 10px 20px; background: linear-gradient(to bottom, #f8fafc, #ffffff); border-bottom: 1px solid #e5e7eb; display: flex; flex-direction: column; gap: 8px;">
					<!-- שורה ראשונה: שנה, סמסטר וכפתור רענן -->
					<div style="display: flex; gap: 12px; align-items: center; justify-content: space-between;">
						<div style="display: flex; gap: 12px; align-items: center;">
							<label style="display: flex; align-items: center; gap: 6px;">
								<span style="font-weight: 500; font-size: 0.875rem; color: #64748b;">שנה:</span>
								<select id="jct-filter-year" style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; cursor: pointer; font-size: 0.875rem;">
									<option value="" ${savedFilterYear === '' ? 'selected' : ''}>בחר...</option>
									<option value="5784" ${savedFilterYear === '5784' ? 'selected' : ''}>תשפ"ד</option>
									<option value="5785" ${savedFilterYear === '5785' ? 'selected' : ''}>תשפ"ה</option>
									<option value="5786" ${savedFilterYear === '5786' ? 'selected' : ''}>תשפ"ו</option>
									<option value="5787" ${savedFilterYear === '5787' ? 'selected' : ''}>תשפ"ז</option>
									<option value="5788" ${savedFilterYear === '5788' ? 'selected' : ''}>תשפ"ח</option>
									<option value="5789" ${savedFilterYear === '5789' ? 'selected' : ''}>תשפ"ט</option>
									<option value="5790" ${savedFilterYear === '5790' ? 'selected' : ''}>תש"צ</option>
								</select>
							</label>
							<label style="display: flex; align-items: center; gap: 6px;">
								<span style="font-weight: 500; font-size: 0.875rem; color: #64748b;">סמסטר:</span>
								<select id="jct-filter-semester" style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; cursor: pointer; font-size: 0.875rem;">
									<option value="" ${savedFilterSemester === '' ? 'selected' : ''}>בחר...</option>
									<option value="0" ${savedFilterSemester === '0' ? 'selected' : ''}>אלול</option>
									<option value="1" ${savedFilterSemester === '1' ? 'selected' : ''}>א'</option>
									<option value="2" ${savedFilterSemester === '2' ? 'selected' : ''}>ב'</option>
								</select>
							</label>
						</div>
						<button id="jct-refresh-assignments" style="padding: 6px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 0.875rem; transition: all 0.2s; box-shadow: 0 1px 3px rgba(59, 130, 246, 0.3);" title="רענן - בודק סטטוס הגשות מחדש. Shift+לחיצה - מרענן גם תאריכי הגשה">
							🔄 רענן
						</button>
					</div>

					<!-- שורה שנייה: מסננים קומפקטיים -->
					<div style="display: flex; gap: 12px; align-items: center; padding: 6px 10px; background: #f1f5f9; border-radius: 6px;">
						<label style="display: flex; align-items: center; gap: 5px;">
							<span style="font-weight: 500; font-size: 0.8125rem; color: #475569;">הסתר איחור מעל</span>
							<input id="jct-max-overdue-days" type="number" min="0" step="1" value="${maxOverdueDays}" style="width: 55px; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 4px; background: white; font-size: 0.8125rem; text-align: center;">
							<span style="font-size: 0.75rem; color: #94a3b8;">ימים</span>
						</label>
						<div style="width: 1px; height: 20px; background: #cbd5e1;"></div>
						<label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
							<input type="checkbox" id="jct-hide-submitted" ${hideSubmitted ? 'checked' : ''} style="width: 15px; height: 15px; cursor: pointer;">
							<span style="font-weight: 500; font-size: 0.8125rem; color: #475569;">הסתר מטלות שהוגשו</span>
						</label>
					</div>
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
		isModalOpening = false; // Modal is now in DOM

		// Track if scanning is in progress
		let isScanning = false;

		// Close button
		modal.querySelector('.jct-assignments-modal-close').addEventListener('click', () => {
			if (!isScanning) {
				modal.remove();
				window.jctStopScanning = true;
				isModalOpening = false;
			}
		});

		// Click outside to close (only when not scanning)
		modal.addEventListener('click', (e) => {
			if (e.target === modal && !isScanning) {
				modal.remove();
				isModalOpening = false;
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
						const isSubmitted = assign.submissionStatus === 'submitted';
						const msPerDay = 24 * 60 * 60 * 1000;
						const daysUntilDue = Math.ceil((dueDate - now) / msPerDay);

						let dateColor = '#64748b'; // default gray
						let dateText = '';

						// If submitted, always show in green regardless of due date
						if (isSubmitted) {
							dateColor = '#16a34a'; // green
							dateText = ''; // No additional text needed when submitted
						} else if (isOverdue) {
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
								📅 ${formattedDate}${dateText ? ` (${dateText})` : ''}
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

					// Add submission status indicator
					let statusHtml = '';
					if (assign.submissionStatus === 'submitted') {
						statusHtml = `
							<div class="jct-assignment-status submitted" style="font-size: 0.75rem; color: #16a34a; margin-top: 4px; font-weight: 600; display: flex; align-items: center; gap: 4px;">
								<span>✓</span>
								<span>הוגש</span>
							</div>
						`;
					} else if (assign.submissionStatus === 'not_submitted') {
						statusHtml = `
							<div class="jct-assignment-status not-submitted" style="font-size: 0.75rem; color: #dc2626; margin-top: 4px; font-weight: 600; display: flex; align-items: center; gap: 4px;">
								<span>✗</span>
								<span>לא הוגש</span>
							</div>
						`;
					}

					html += `
						<div class="jct-assignment-box">
							<div class="jct-assignment-box-name">${assign.assignmentName}</div>
							${dueDateHtml}
							${statusHtml}
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
		async function loadAndDisplayAssignments(forceRefresh = false, savedYear = '', savedSemester = '') {
			// Get filter values from the UI
			const filterYear = document.getElementById('jct-filter-year')?.value || '';
			const filterSemester = document.getElementById('jct-filter-semester')?.value || '';
			const maxOverdueDays = parseInt(document.getElementById('jct-max-overdue-days')?.value || '30');
			const hideSubmitted = document.getElementById('jct-hide-submitted')?.checked || false;

			// Check if year and semester are selected (required)
			if (!filterYear || !filterSemester) {
				const statusEl = document.getElementById('jct-loading-status');
				if (statusEl) {
					statusEl.innerHTML = `
						<div style="text-align: center; padding: 20px;">
							<p style="font-size: 1rem; color: #ef4444; margin-bottom: 12px;">⚠️ יש לבחור שנה וסמסטר לפני הסריקה</p>
							<p style="font-size: 0.875rem; color: #94a3b8;">בחר שנה וסמסטר מהתפריט למעלה ולחץ על "רענן"</p>
						</div>
					`;
				}
				return;
			}

			// Check if we have cache
			const { cache, timestamp } = await getAssignmentsCache();
			const hasCache = cache && cache.assignments && cache.assignments.length > 0;
			const cacheValid = hasCache && isCacheValid(timestamp);

			// Check if year/semester changed
			const yearSemesterChanged = (savedYear !== '' && savedSemester !== '' && (savedYear !== filterYear || savedSemester !== filterSemester));

			// If we have valid cache and year/semester didn't change, just refilter without scanning
			// This happens when: 1) Initial load with cache, or 2) User only changed maxOverdueDays
			if (cacheValid && !yearSemesterChanged) {
				// We have cache - first display immediately with cached status
				await refilterAndDisplayFromCache(cache, maxOverdueDays, filterYear, filterSemester, false, hideSubmitted);

				// Then update status in background ONLY if we haven't done it yet in this modal session OR if explicitly requested (forceRefresh)
				if (!hasRefreshedStatusGlobal || forceRefresh) {
					hasRefreshedStatusGlobal = true;
					refilterAndDisplayFromCache(cache, maxOverdueDays, filterYear, filterSemester, true, hideSubmitted);
				}
				return;
			}

			// Show warning modal before starting scan (only if we're actually going to scan)
			const shouldProceed = await showScanWarning();
			if (!shouldProceed) {
				return;
			}

			// Disable all filter controls during scan and hide close button
			const filterYearSelect = document.getElementById('jct-filter-year');
			const filterSemesterSelect = document.getElementById('jct-filter-semester');
			const maxOverdueDaysInput = document.getElementById('jct-max-overdue-days');
			const refreshBtn = document.getElementById('jct-refresh-assignments');
			const closeBtn = modal.querySelector('.jct-assignments-modal-close');
			const scanningNotice = document.getElementById('jct-scanning-notice');

			if (filterYearSelect) filterYearSelect.disabled = true;
			if (filterSemesterSelect) filterSemesterSelect.disabled = true;
			if (maxOverdueDaysInput) maxOverdueDaysInput.disabled = true;
			if (refreshBtn) refreshBtn.disabled = true;
			if (closeBtn) closeBtn.style.display = 'none';
			if (scanningNotice) scanningNotice.style.display = 'block';

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

			// Scan all courses
			window.jctStopScanning = false;
			const result = await scanAllCoursesForAssignments(forceRefresh, filterYear, filterSemester);

			// Display results (either from cache or fresh scan)
			if (result) {
				if (statusEl) {
					statusEl.innerHTML = `<span class="jct-loading-spinner-small"></span> בודק תאריכי סיום וסטטוס הגשות...`;
				}

				// Fetch due dates and submission status for all assignments
				const assignmentsWithData = await Promise.all(
					result.assignments.map(async (assign) => {
						const dueDate = await getAssignmentDueDate(assign.assignmentUrl, assign.assignmentId);
						const submissionStatus = await getAssignmentSubmissionStatus(assign.assignmentUrl, assign.assignmentId, true);
						return { ...assign, dueDate, submissionStatus };
					})
				);

				// Filter assignments by due date and submission status
				const filteredAssignments = assignmentsWithData.filter(assign => {
					// Check due date
					if (!shouldShowAssignment(assign.dueDate, maxOverdueDays)) {
						return false;
					}
					// Check submission status if hideSubmitted is enabled
					if (hideSubmitted && assign.submissionStatus === 'submitted') {
						return false;
					}
					return true;
				});

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

			// Re-enable all controls after scan completes and show close button
			if (filterYearSelect) filterYearSelect.disabled = false;
			if (filterSemesterSelect) filterSemesterSelect.disabled = false;
			if (maxOverdueDaysInput) maxOverdueDaysInput.disabled = false;
			if (refreshBtn) refreshBtn.disabled = false;
			if (closeBtn) closeBtn.style.display = '';
			if (scanningNotice) scanningNotice.style.display = 'none';

			// Save the current year/semester to storage so next time we can detect if they changed
			await new Promise(resolve => {
				chrome.storage.sync.set({
					assignmentFilterYear: filterYear,
					assignmentFilterSemester: filterSemester
				}, () => resolve());
			});
		}

		// Function to show scan warning modal
		async function showScanWarning() {
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
							<button class="jct-scan-warning-cancel">ביטול</button>
							<button class="jct-scan-warning-proceed">המשך בסריקה</button>
						</div>
					</div>
				`;
				document.body.appendChild(warningModal);

				// Add styles
				const style = document.createElement('style');
				style.textContent = `
					.jct-scan-warning-modal {
						position: fixed;
						top: 0;
						left: 0;
						right: 0;
						bottom: 0;
						z-index: 100000;
					}
					.jct-scan-warning-overlay {
						position: absolute;
						top: 0;
						left: 0;
						right: 0;
						bottom: 0;
						background: rgba(0, 0, 0, 0.5);
						backdrop-filter: blur(2px);
					}
					.jct-scan-warning-content {
						position: absolute;
						top: 50%;
						left: 50%;
						transform: translate(-50%, -50%);
						background: white;
						border-radius: 12px;
						padding: 24px;
						max-width: 400px;
						box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
						text-align: center;
					}
					.jct-scan-warning-icon {
						font-size: 48px;
						margin-bottom: 16px;
					}
					.jct-scan-warning-content h3 {
						margin: 0 0 16px 0;
						font-size: 1.25rem;
						color: #1e293b;
					}
					.jct-scan-warning-content p {
						margin: 0 0 8px 0;
						color: #475569;
						line-height: 1.6;
					}
					.jct-scan-warning-buttons {
						display: flex;
						gap: 12px;
						margin-top: 24px;
					}
					.jct-scan-warning-buttons button {
						flex: 1;
						padding: 10px 20px;
						border: none;
						border-radius: 8px;
						font-size: 1rem;
						cursor: pointer;
						font-weight: 500;
						transition: all 0.2s;
					}
					.jct-scan-warning-cancel {
						background: #e2e8f0;
						color: #475569;
					}
					.jct-scan-warning-cancel:hover {
						background: #cbd5e1;
					}
					.jct-scan-warning-proceed {
						background: #3b82f6;
						color: white;
					}
					.jct-scan-warning-proceed:hover {
						background: #2563eb;
					}
				`;
				document.head.appendChild(style);

				const cancelBtn = warningModal.querySelector('.jct-scan-warning-cancel');
				const proceedBtn = warningModal.querySelector('.jct-scan-warning-proceed');

				cancelBtn.addEventListener('click', () => {
					warningModal.remove();
					style.remove();
					resolve(false);
				});

				proceedBtn.addEventListener('click', () => {
					warningModal.remove();
					style.remove();
					resolve(true);
				});

				// Close on overlay click
				warningModal.querySelector('.jct-scan-warning-overlay').addEventListener('click', () => {
					warningModal.remove();
					style.remove();
					resolve(false);
				});
			});
		}

		// Function to refilter and display from cache without scanning
		async function refilterAndDisplayFromCache(cachedData, maxOverdueDays, filterYear, filterSemester, forceRefreshStatus = false, hideSubmitted = false) {
			const statusEl = document.getElementById('jct-loading-status');

			// Show appropriate message
			if (statusEl) {
				if (forceRefreshStatus) {
					statusEl.innerHTML = `<span class="jct-loading-spinner-small"></span> מעדכן סטטוס הגשות...`;
				} else {
					statusEl.innerHTML = `<span class="jct-loading-spinner-small"></span> מסנן מטלות מהמטמון...`;
				}
			}

			// Clear existing results only if NOT refreshing status (first display)
			const container = document.getElementById('jct-results-container');
			if (!forceRefreshStatus) {
				// First display - clear and show fresh
				if (container) {
					container.innerHTML = '';
					totalCourses = 0;
					totalAssignments = 0;
				}
			} else {
				// Refreshing status in background - DON'T disable controls, DON'T show loading message
				// Just let it update silently in the background
			}

			// Filter assignments by year and semester first
			const yearFiltered = cachedData.assignments.filter(assign => {
				const { year, semIdx } = parseHebrewYearAndSemester(assign.courseName);
				return year === parseInt(filterYear) && semIdx === parseInt(filterSemester);
			});

			// Fetch due dates and submission status for filtered assignments only
			const assignmentsWithData = await Promise.all(
				yearFiltered.map(async (assign) => {
					const dueDate = await getAssignmentDueDate(assign.assignmentUrl, assign.assignmentId, forceRefreshStatus);
					const submissionStatus = await getAssignmentSubmissionStatus(assign.assignmentUrl, assign.assignmentId, forceRefreshStatus);
					return { ...assign, dueDate, submissionStatus };
				})
			);

			// Filter assignments by due date and submission status
			const filteredAssignments = assignmentsWithData.filter(assign => {
				// Check due date
				if (!shouldShowAssignment(assign.dueDate, maxOverdueDays)) {
					return false;
				}
				// Check submission status if hideSubmitted is enabled
				if (hideSubmitted && assign.submissionStatus === 'submitted') {
					return false;
				}
				return true;
			});

			// Rebuild courses map from filtered assignments
			const coursesMap = new Map(cachedData.courses);

			// If refreshing status, clear before re-displaying with updated status
			if (forceRefreshStatus && container) {
				container.innerHTML = '';
				totalCourses = 0;
				totalAssignments = 0;
			}

			// Display courses with filtered assignments
			for (const [courseId, courseInfo] of coursesMap) {
				const courseAssignments = filteredAssignments.filter(a => a.courseId === courseId);
				if (courseAssignments.length > 0 && window.jctAddCourseResult) {
					window.jctAddCourseResult(courseInfo, courseAssignments);
				}
			}

			// Update final status
			if (statusEl) {
				const { timestamp } = await getAssignmentsCache();
				const cacheDate = new Date(timestamp);
				const cacheTime = cacheDate.toLocaleString('he-IL');
				const totalBeforeFilter = yearFiltered.length;
				const hiddenCount = totalBeforeFilter - totalAssignments;
				let statusText = `✓ מטלות עודכנו מהמטמון - ${totalCourses} קורסים, ${totalAssignments} מטלות`;
				if (hiddenCount > 0) {
					statusText += ` (${hiddenCount} מוסתרות בגלל תאריך סיום)`;
				}
				statusText += ` | עדכון אחרון: ${cacheTime}`;
				statusEl.innerHTML = statusText;
			}

			// No need to re-enable controls since we didn't disable them during background refresh
		}

		// Add event listeners for filters and refresh button
		const filterYearSelect = document.getElementById('jct-filter-year');
		const filterSemesterSelect = document.getElementById('jct-filter-semester');
		const maxOverdueDaysInput = document.getElementById('jct-max-overdue-days');
		const refreshBtn = document.getElementById('jct-refresh-assignments');

		// When filter changes, don't save to storage yet - only save after successful scan
		// This way we can detect if year/semester changed since last scan
		filterYearSelect?.addEventListener('change', async () => {
			// Just update the UI, don't save yet
		});

		filterSemesterSelect?.addEventListener('change', async () => {
			// Just update the UI, don't save yet
		});

		// When maxOverdueDays changes, apply filter immediately without status refresh
		maxOverdueDaysInput?.addEventListener('change', async () => {
			const newValue = Math.max(0, parseInt(maxOverdueDaysInput.value || '30'));
			await new Promise(resolve => {
				chrome.storage.sync.set({ maxOverdueDays: newValue }, () => resolve());
			});

			// Refilter existing data immediately
			const { cache, timestamp } = await getAssignmentsCache();
			if (cache && isCacheValid(timestamp)) {
				const filterYear = document.getElementById('jct-filter-year')?.value || '';
				const filterSemester = document.getElementById('jct-filter-semester')?.value || '';
				const hideSubmitted = document.getElementById('jct-hide-submitted')?.checked || false;
				await refilterAndDisplayFromCache(cache, newValue, filterYear, filterSemester, false, hideSubmitted);
			}
		});

		// When hideSubmitted checkbox changes, apply filter immediately without status refresh
		const hideSubmittedCheckbox = document.getElementById('jct-hide-submitted');
		hideSubmittedCheckbox?.addEventListener('change', async () => {
			const isChecked = hideSubmittedCheckbox.checked;
			await new Promise(resolve => {
				chrome.storage.sync.set({ hideSubmittedAssignments: isChecked }, () => resolve());
			});

			// Refilter existing data immediately
			const { cache, timestamp } = await getAssignmentsCache();
			if (cache && isCacheValid(timestamp)) {
				const filterYear = document.getElementById('jct-filter-year')?.value || '';
				const filterSemester = document.getElementById('jct-filter-semester')?.value || '';
				const maxOverdueDays = parseInt(document.getElementById('jct-max-overdue-days')?.value || '30');
				await refilterAndDisplayFromCache(cache, maxOverdueDays, filterYear, filterSemester, false, isChecked);
			}
		});

		// Refresh button click handler
		refreshBtn?.addEventListener('click', async (e) => {
			const clearCache = e.shiftKey;

			// Mark scanning as in progress
			isScanning = true;

			refreshBtn.innerHTML = clearCache ? '⏳ מנקה מטמון...' : '⏳ מרענן...';

			// Hide close button and show scanning notice
			const closeBtn = modal.querySelector('.jct-assignments-modal-close');
			const scanningNotice = document.getElementById('jct-scanning-notice');
			if (closeBtn) {
				closeBtn.style.display = 'none';
			}
			if (scanningNotice) {
				scanningNotice.style.display = 'block';
			}

			// Always clear submission status cache to check if submitted
			// If Shift is pressed, also clear due date cache
			if (clearCache) {
				// Clear both due date cache and submission status cache
				await new Promise(resolve => {
					chrome.storage.local.set({
						dueDateCache: {},
						submissionStatusCache: {}
					}, () => resolve());
				});
			} else {
				// Clear only submission status cache
				await new Promise(resolve => {
					chrome.storage.local.set({
						submissionStatusCache: {}
					}, () => resolve());
				});
			}

			// Get the current saved values from storage (they might have changed)
			const currentSettings = await new Promise(resolve => {
				chrome.storage.sync.get(['assignmentFilterYear', 'assignmentFilterSemester'], resolve);
			});
			const currentSavedYear = currentSettings.assignmentFilterYear || '';
			const currentSavedSemester = currentSettings.assignmentFilterSemester || '';

			// Reset the flag so status will be refreshed
			hasRefreshedStatusGlobal = false;

			await loadAndDisplayAssignments(true, currentSavedYear, currentSavedSemester);

			// Mark scanning as complete
			isScanning = false;

			refreshBtn.innerHTML = '🔄 רענן';

			// Show close button and hide scanning notice
			if (closeBtn) {
				closeBtn.style.display = '';
			}
			if (scanningNotice) {
				scanningNotice.style.display = 'none';
			}
		});

		// Check if we have cached data to display
		const { cache, timestamp } = await getAssignmentsCache();
		if (cache && isCacheValid(timestamp)) {
			// Display cached data
			await loadAndDisplayAssignments(false);
		} else {
			// No valid cache - show message to select year/semester and click refresh
			const statusEl = document.getElementById('jct-loading-status');
			if (statusEl) {
				statusEl.innerHTML = `
					<div style="text-align: center; padding: 20px;">
						<p style="font-size: 1rem; color: #64748b; margin-bottom: 12px;">בחר שנה וסמסטר ולחץ על "רענן" כדי לסרוק מטלות</p>
					</div>
				`;
			}
		}
	}

	function addSettingsButton() {
		// Only show buttons on main page
		const body = document.body;
		if (!body || body.id !== 'page-site-index') return;

		// Check if buttons already exist
		if (document.getElementById('jct-settings-button') || document.getElementById('jct-show-all-assignments-button')) {
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

		// Add "Calendar View" button
		const calendarBtn = document.createElement('button');
		calendarBtn.id = 'jct-calendar-button';
		calendarBtn.className = 'jct-settings-button jct-calendar-button';
		calendarBtn.innerHTML = '📅 לוח שנה';
		calendarBtn.title = 'הצג לוח שנה עם מטלות ואירועים';

		calendarBtn.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();

			// Prevent multiple clicks
			if (calendarBtn.disabled) return;

			// Check if modal already open
			if (document.querySelector('.jct-calendar-modal')) return;

			calendarBtn.disabled = true;
			calendarBtn.innerHTML = '⏳ טוען...';

			try {
				await showCalendarModal();
			} finally {
				calendarBtn.disabled = false;
				calendarBtn.innerHTML = '📅 לוח שנה';
			}
		});

		// Create a grid container for the new layout
		const buttonContainer = document.createElement('div');
		buttonContainer.className = 'jct-action-buttons-container';

		// Create single row with all 3 buttons
		const buttonsRow = document.createElement('div');
		buttonsRow.className = 'jct-buttons-row';
		buttonsRow.appendChild(calendarBtn);
		buttonsRow.appendChild(assignmentsBtn);
		buttonsRow.appendChild(settingsBtn);

		buttonContainer.appendChild(buttonsRow);

		// Insert the button container after the page header
		if (pageHeader) {
			pageHeader.parentElement.insertBefore(buttonContainer, pageHeader.nextSibling);
		} else if (pageTitleContainer) {
			pageTitleContainer.parentElement.insertBefore(buttonContainer, pageTitleContainer.nextSibling);
		} else {
			// Fallback: fixed position top left (right in RTL)
			calendarBtn.style.position = 'fixed';
			calendarBtn.style.top = '20px';
			calendarBtn.style.left = '20px';
			calendarBtn.style.zIndex = '10000';

			assignmentsBtn.style.position = 'fixed';
			assignmentsBtn.style.top = '20px';
			assignmentsBtn.style.left = '80px';
			assignmentsBtn.style.zIndex = '10000';
			settingsBtn.style.position = 'fixed';
			settingsBtn.style.top = '20px';
			settingsBtn.style.left = '140px';
			settingsBtn.style.zIndex = '10000';
			document.body.appendChild(calendarBtn);
			document.body.appendChild(assignmentsBtn);
			document.body.appendChild(settingsBtn);
		}

		// Show today's events block automatically
		showTodayEventsBlock(buttonContainer);
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

		// Clear assignment submission cache if we're on an assignment page
		if (window.location.href.includes('/mod/assign/view.php')) {
			const urlParams = new URLSearchParams(window.location.search);
			const assignmentId = urlParams.get('id');
			if (assignmentId) {
				chrome.storage.local.get({ submissionStatusCache: {} }, res => {
					const cache = res.submissionStatusCache || {};
					// Find and remove cache entries for this assignment
					Object.keys(cache).forEach(key => {
						if (key.includes(`-${assignmentId}`)) {
							delete cache[key];
						}
					});
					chrome.storage.local.set({ submissionStatusCache: cache });
				});
			}
		}

		// Don't auto-scan - user must click refresh button manually

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

		// Global event delegation for favorite and schedule buttons
		// This ensures buttons work even if they're replaced or recreated
		document.addEventListener('click', (e) => {
			// Check if clicked on favorite button
			const favBtn = e.target.closest('.jct-fav-toggle');
			if (favBtn) {
				e.stopPropagation();
				e.preventDefault();
				const card = favBtn.closest('.list-group-item, .coursebox, .card.course, li, .dashboard-card');
				if (card) {
					const cid = getCourseIdFromCard(card);
					toggleFavorite(cid);
				}
				return;
			}

			// Check if clicked on schedule button
			const scheduleBtn = e.target.closest('.jct-schedule-btn');
			if (scheduleBtn) {
				e.stopPropagation();
				e.preventDefault();
				const card = scheduleBtn.closest('.list-group-item, .coursebox, .card.course, li, .dashboard-card');
				if (card) {
					const courseId = getCourseIdFromCard(card);
					showScheduleDayPicker(courseId, card);
				}
				return;
			}
		}, true); // Use capture phase to catch the event before other handlers
	});
})();
