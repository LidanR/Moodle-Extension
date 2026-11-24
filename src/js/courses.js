(function (JCT) {
	'use strict';

	const {
		COURSE_CONTAINER_SELECTORS,
		CARD_SELECTOR,
		CARD_CLOSEST_SELECTOR,
		COURSE_LINK_SELECTOR
	} = JCT.config;

	const {
		parseHebrewYearAndSemester,
		getSemesterName,
		colorFor,
		isExcludedCourse,
		getCourseIdFromCard,
		getCourseNameFromCard,
		getCourseUrlFromCard,
		getStyledCardEl,
		getPlaceholderUrl
	} = JCT.utils;

	const originalCoursesMap = new WeakMap();

	function applyCardStyle(style) {
		JCT.state.currentCardStyle = style || 'compact';
		document.body.classList.remove(
			'jct-style-compact',
			'jct-style-minimal',
			'jct-style-cards',
			'jct-style-modern',
			'jct-style-glass'
		);
		document.body.classList.add(`jct-style-${JCT.state.currentCardStyle}`);
	}

	function applyViewMode(mode) {
		JCT.state.currentViewMode = mode || 'grid';
		document.body.classList.remove('jct-courses-list-view', 'jct-view-original', 'jct-view-carousel');

		const containers = document.querySelectorAll('.jct-courses-grid');
		containers.forEach((coursesContainer) => {
			const parentContainer =
				coursesContainer.closest('.course-content, #frontpage-course-list, .courses') ||
				coursesContainer.parentElement;
			if (parentContainer) {
				parentContainer.classList.remove('jct-courses-list-view', 'jct-view-original', 'jct-view-carousel');
				if (mode === 'list') parentContainer.classList.add('jct-courses-list-view');
				else if (mode === 'original') parentContainer.classList.add('jct-view-original');
				else if (mode === 'carousel') parentContainer.classList.add('jct-view-carousel');
			}
		});

		if (mode === 'list') {
			document.body.classList.add('jct-courses-list-view');
			restoreOriginalCourses();
		} else if (mode === 'original') {
			document.body.classList.add('jct-view-original');
			restoreOriginalCourses();
		} else if (mode === 'carousel') {
			document.body.classList.add('jct-view-carousel');
			let needsInit = false;
			containers.forEach((container) => {
				if (!container.querySelector('.jct-semester-group')) {
					needsInit = true;
				}
			});
			if (needsInit) {
				initializeCarouselView();
			}
		} else {
			restoreOriginalCourses();
			document.documentElement.style.setProperty('--jct-columns', String(JCT.state.currentColumnCount));
		}
	}

	function attachCardInteractions(card) {
		const mainLink = card.querySelector(COURSE_LINK_SELECTOR);
		if (mainLink && mainLink.href && !card.dataset.jctClickBound) {
			card.dataset.jctClickBound = '1';
			card.classList.add('jct-clickable');
			card.style.cursor = 'pointer';

			let isDragging = false;
			let dragStartX = 0;
			let dragStartY = 0;

			card.addEventListener('mousedown', (e) => {
				if (e.target.closest('.jct-fav-toggle, .jct-schedule-btn, button')) return;
				dragStartX = e.clientX;
				dragStartY = e.clientY;
				isDragging = false;
			});

			card.addEventListener('mousemove', (e) => {
				if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) {
					isDragging = true;
				}
			});

			card.addEventListener('click', (e) => {
				if (e.target.closest('.jct-fav-toggle, .jct-schedule-btn, button, a[href*="/course/view.php"]')) {
					return;
				}
				if (isDragging) {
					isDragging = false;
					return;
				}
				window.location.href = mainLink.href;
			});
		}

		if (!card.dataset.jctDragBound) {
			card.dataset.jctDragBound = '1';
			card.setAttribute('draggable', 'true');
			let scrollInterval = null;

			const clearAutoScroll = () => {
				if (scrollInterval) {
					clearInterval(scrollInterval);
					scrollInterval = null;
				}
			};

			card.addEventListener('dragstart', (e) => {
				const courseId = getCourseIdFromCard(card);
				if (!courseId) return;
				const data = {
					courseId,
					courseName: getCourseNameFromCard(card),
					courseUrl: getCourseUrlFromCard(card),
					fromCourseList: true
				};
				e.dataTransfer.setData('text/plain', JSON.stringify(data));
				e.dataTransfer.effectAllowed = 'copy';
				card.style.opacity = '0.5';
			});

			card.addEventListener('drag', (e) => {
				const scrollThreshold = 80;
				const scrollSpeed = 15;
				if (e.clientY > 0 && e.clientY < window.innerHeight) {
					clearAutoScroll();
					if (e.clientY < scrollThreshold) {
						scrollInterval = setInterval(() => window.scrollBy(0, -scrollSpeed), 20);
					} else if (e.clientY > window.innerHeight - scrollThreshold) {
						scrollInterval = setInterval(() => window.scrollBy(0, scrollSpeed), 20);
					}
				}
			});

			card.addEventListener('dragend', () => {
				card.style.opacity = '1';
				clearAutoScroll();
			});
		}
	}

	function initializeCarouselView() {
		const containers = document.querySelectorAll('.jct-courses-grid');
		containers.forEach((container) => {
			if (container.querySelector('.jct-semester-group')) return;

			container.setAttribute('data-jct-carousel-initialized', 'true');

			const courses = Array.from(container.children).filter((child) => {
				if (child.classList.contains('paging') || child.classList.contains('paging-morelink')) {
					return false;
				}
				const link = child.querySelector(COURSE_LINK_SELECTOR);
				if (link && isExcludedCourse(link.textContent.trim())) {
					return false;
				}
				return true;
			});

			if (courses.length === 0) return;

			if (!originalCoursesMap.has(container)) {
				originalCoursesMap.set(container, courses.map((course) => course.cloneNode(true)));
			}

			const groups = new Map();

			courses.forEach((course) => {
				const cloned = course.cloneNode(true);
				delete cloned.dataset.jctClickBound;
				delete cloned.dataset.jctDragBound;

				const courseId = getCourseIdFromCard(course);
				if (courseId) {
					cloned.setAttribute('data-course-id', courseId);
				}
				cloned.classList.add('jct-course-card');

				cloned.querySelectorAll('a').forEach((link) => {
					link.style.pointerEvents = 'auto';
					link.style.cursor = 'pointer';
				});

				attachCardInteractions(cloned);

				const text = cloned.innerText || cloned.textContent || '';
				const { year, semIdx } = parseHebrewYearAndSemester(text);
				const groupKey = year != null || semIdx != null ? `${year || 'none'}-${semIdx ?? 'none'}` : 'other';

				if (!groups.has(groupKey)) {
					groups.set(groupKey, {
						year,
						semIdx,
						label: getSemesterName(year, semIdx),
						courses: []
					});
				}
				groups.get(groupKey).courses.push(cloned);
			});

			JCT.state.isReordering = true;
			try {
				container.innerHTML = '';

				groups.forEach((group) => {
					const semesterDiv = document.createElement('div');
					semesterDiv.className = 'jct-semester-group';

					const header = document.createElement('div');
					header.className = 'jct-semester-header';
					header.textContent = group.label || 'קורסים';
					semesterDiv.appendChild(header);

					const carouselWrapper = document.createElement('div');
					carouselWrapper.className = 'jct-carousel-wrapper';

					const carouselContainer = document.createElement('div');
					carouselContainer.className = 'jct-carousel-container';
					carouselContainer.setAttribute('data-carousel-index', '0');

					group.courses.forEach((course) => carouselContainer.appendChild(course));
					reorderContainerByFavorites(carouselContainer);

					carouselWrapper.appendChild(carouselContainer);
					semesterDiv.appendChild(carouselWrapper);

					if (group.courses.length > 1) {
						const prevBtn = document.createElement('button');
						prevBtn.type = 'button';
						prevBtn.className = 'jct-carousel-btn jct-carousel-btn-prev';
						prevBtn.textContent = '◀';
						prevBtn.disabled = true;
						prevBtn.addEventListener('click', () => moveCarousel(carouselContainer, -1, group.courses.length));

						const nextBtn = document.createElement('button');
						nextBtn.type = 'button';
						nextBtn.className = 'jct-carousel-btn jct-carousel-btn-next';
						nextBtn.textContent = '▶';
						nextBtn.addEventListener('click', () => moveCarousel(carouselContainer, 1, group.courses.length));

						semesterDiv.appendChild(prevBtn);
						semesterDiv.appendChild(nextBtn);

						const indicators = document.createElement('div');
						indicators.className = 'jct-carousel-indicators';
						for (let i = 0; i < group.courses.length; i++) {
							const dot = document.createElement('div');
							dot.className = 'jct-carousel-dot' + (i === 0 ? ' active' : '');
							dot.addEventListener('click', () =>
								moveCarouselToIndex(carouselContainer, i, group.courses.length, indicators)
							);
							indicators.appendChild(dot);
						}
						semesterDiv.appendChild(indicators);
					}

					container.appendChild(semesterDiv);
				});
			} finally {
				JCT.state.isReordering = false;
			}
		});
	}

	function restoreOriginalCourses() {
		let restoredAny = false;
		const containers = document.querySelectorAll('.jct-courses-grid');
		JCT.state.isReordering = true;
		try {
			containers.forEach((container) => {
				if (container.querySelector('.jct-semester-group')) {
					const originalCourses = originalCoursesMap.get(container);
					if (originalCourses) {
						container.innerHTML = '';
						originalCourses.forEach((course) => {
							const clone = course.cloneNode(true);
							delete clone.dataset.jctClickBound;
							delete clone.dataset.jctDragBound;
							container.appendChild(clone);
						});
						container.removeAttribute('data-jct-carousel-initialized');
						restoredAny = true;
					}
				}
			});
		} finally {
			JCT.state.isReordering = false;
		}

		if (restoredAny) {
			ensureStructureAndColor();
		}
	}

	function updateCarouselPosition(container, newIndex, totalItems, indicatorsEl) {
		const clamped = Math.max(0, Math.min(totalItems - 1, newIndex));
		container.setAttribute('data-carousel-index', String(clamped));

		const isRtl = document.documentElement.dir === 'rtl' || document.documentElement.classList.contains('jct-rtl');
		const firstItem = container.firstElementChild;
		const itemWidth = firstItem ? firstItem.getBoundingClientRect().width : 320;
		const computedGap = parseFloat(window.getComputedStyle(container).columnGap || window.getComputedStyle(container).gap) || 20;
		const step = itemWidth + computedGap;
		const offset = isRtl ? clamped * step : -(clamped * step);
		container.style.transform = `translateX(${offset}px)`;

		const semesterGroup = container.closest('.jct-semester-group');
		if (semesterGroup) {
			const prevBtn = semesterGroup.querySelector('.jct-carousel-btn-prev');
			const nextBtn = semesterGroup.querySelector('.jct-carousel-btn-next');
			if (prevBtn) prevBtn.disabled = clamped === 0;
			if (nextBtn) nextBtn.disabled = clamped === totalItems - 1;

			const dotsParent = indicatorsEl || semesterGroup.querySelector('.jct-carousel-indicators');
			if (dotsParent) {
				dotsParent.querySelectorAll('.jct-carousel-dot').forEach((dot, idx) => {
					dot.classList.toggle('active', idx === clamped);
				});
			}
		}
	}

	let carouselResizeTimer = null;
	window.addEventListener('resize', () => {
		if (!document.body?.classList.contains('jct-view-carousel')) return;
		clearTimeout(carouselResizeTimer);
		carouselResizeTimer = setTimeout(() => {
			document.querySelectorAll('.jct-carousel-container').forEach((container) => {
				const idx = parseInt(container.getAttribute('data-carousel-index') || '0', 10);
				if (container.children.length > 0) {
					updateCarouselPosition(container, idx, container.children.length);
				}
			});
		}, 120);
	});

	function moveCarousel(container, direction, totalItems) {
		const currentIndex = parseInt(container.getAttribute('data-carousel-index') || '0', 10);
		updateCarouselPosition(container, currentIndex + direction, totalItems);
	}

	function moveCarouselToIndex(container, index, totalItems, indicatorsEl) {
		updateCarouselPosition(container, index, totalItems, indicatorsEl);
	}

	function removeUnwantedCourses() {
		const allCourseLinks = document.querySelectorAll('a[href*="/course/view.php"]');
		allCourseLinks.forEach((link) => {
			if (isExcludedCourse(link.textContent.trim())) {
				const courseCard = link.closest(CARD_CLOSEST_SELECTOR);
				if (courseCard) {
					courseCard.remove();
				}
			}
		});
	}

	function markCoursesContainers() {
		const containers = document.querySelectorAll(COURSE_CONTAINER_SELECTORS.join(','));
		containers.forEach((el) => {
			if (!el.classList.contains('jct-courses-grid')) {
				el.classList.add('jct-courses-grid');
			}
		});
	}

	function ensureStructureAndColor() {
		const cards = document.querySelectorAll(CARD_SELECTOR);
		cards.forEach((card) => {
			const link = card.querySelector(COURSE_LINK_SELECTOR);
			if (link && isExcludedCourse(link.textContent.trim())) {
				card.style.display = 'none';
				return;
			}

			if (!card.style.position) card.style.position = 'relative';
			card.classList.add('jct-course-card');

			const courseId = getCourseIdFromCard(card);
			if (courseId) {
				card.setAttribute('data-course-id', courseId);
			}

			// Thumbnail wrapper
			let topThumb = card.querySelector('.jct-thumb-wrap');
			if (!topThumb) {
				topThumb = document.createElement('div');
				topThumb.className = 'jct-thumb-wrap';
				card.insertBefore(topThumb, card.firstChild);
			}
			const img = card.querySelector('img.courseimage, .courseimage img, img[src*="pluginfile"], img[src*="/course/overview"]');
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

			// Compute accent color by semester (same color per semester across all years)
			const text = card.innerText || card.textContent || '';
			const { semIdx } = parseHebrewYearAndSemester(text);
			const color = colorFor(semIdx);
			const styledEl = getStyledCardEl(card);
			styledEl.style.setProperty('--jct-accent-h', String(color.h));
			styledEl.style.setProperty('--jct-accent-s', `${color.s}%`);
			styledEl.style.setProperty('--jct-accent-l', `${color.l}%`);

			if (color.isYearly && color.secondary) {
				styledEl.classList.add('jct-course-yearly');
				styledEl.style.setProperty('--jct-accent-2-h', String(color.secondary.h));
				styledEl.style.setProperty('--jct-accent-2-s', `${color.secondary.s}%`);
				styledEl.style.setProperty('--jct-accent-2-l', `${color.secondary.l}%`);
			} else {
				styledEl.classList.remove('jct-course-yearly');
				styledEl.style.removeProperty('--jct-accent-2-h');
				styledEl.style.removeProperty('--jct-accent-2-s');
				styledEl.style.removeProperty('--jct-accent-2-l');
			}

			// Favorite button
			let favBtn = card.querySelector('.jct-fav-toggle');
			if (!favBtn) {
				favBtn = document.createElement('button');
				favBtn.type = 'button';
				favBtn.className = 'jct-fav-toggle';
				favBtn.title = 'סמן כמועדף';
				card.insertBefore(favBtn, card.firstChild);
			}
			const fav = JCT.storage.isFavorite(courseId);
			card.setAttribute('data-jct-fav', fav ? '1' : '0');
			favBtn.classList.toggle('jct-fav-on', fav);
			favBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
			favBtn.textContent = fav ? '★' : '☆';

			// Schedule button
			let scheduleBtn = card.querySelector('.jct-schedule-btn');
			if (!scheduleBtn) {
				scheduleBtn = document.createElement('button');
				scheduleBtn.type = 'button';
				scheduleBtn.className = 'jct-schedule-btn';
				scheduleBtn.title = 'הוסף למערכת שעות (לחץ לעריכה או גרור למערכת)';
				scheduleBtn.textContent = '📅';
				scheduleBtn.setAttribute('draggable', 'true');
				card.insertBefore(scheduleBtn, card.firstChild);
			}

			scheduleBtn.ondragstart = (e) => {
				e.stopPropagation();
				const data = {
					courseId: getCourseIdFromCard(card),
					courseName: getCourseNameFromCard(card),
					courseUrl: getCourseUrlFromCard(card)
				};
				e.dataTransfer.setData('text/plain', JSON.stringify(data));
				e.dataTransfer.effectAllowed = 'copy';
				card.style.opacity = '0.5';
				const scheduleContainer = document.getElementById('jct-weekly-schedule');
				if (scheduleContainer) {
					setTimeout(() => {
						scheduleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
					}, 100);
				}
			};

			scheduleBtn.ondragend = () => {
				card.style.opacity = '1';
			};

			if (!card.hasAttribute('data-jct-idx') && card.parentElement) {
				const idx = Array.prototype.indexOf.call(card.parentElement.children, card);
				card.setAttribute('data-jct-idx', String(idx));
			}

			attachCardInteractions(card);
		});

		if (JCT.state.currentViewMode === 'grid') {
			document.documentElement.style.setProperty('--jct-columns', String(JCT.state.currentColumnCount));
		}

		JCT.state.isReordering = true;
		try {
			document.querySelectorAll('.jct-courses-grid').forEach(reorderContainerByFavorites);
			document.querySelectorAll('.jct-carousel-container').forEach(reorderContainerByFavorites);
		} finally {
			JCT.state.isReordering = false;
		}
	}

	function reorderContainerByFavorites(container) {
		if (!container) return;
		const children = Array.from(container.children);
		if (children.some((el) => el.classList.contains('jct-semester-group'))) return;

		const withMeta = children.map((card, i) => {
			const idx = Number(card.getAttribute('data-jct-idx') || i);
			const cid = getCourseIdFromCard(card);
			const fav = JCT.storage.isFavorite(cid);
			return { card, fav, idx };
		});

		const sorted = withMeta.slice().sort((a, b) => {
			if (a.fav !== b.fav) return a.fav ? -1 : 1;
			return a.idx - b.idx;
		});

		let changed = false;
		sorted.forEach(({ card }, pos) => {
			if (container.children[pos] !== card) {
				changed = true;
				container.appendChild(card);
			}
		});

		if (changed) {
			Array.from(container.children).forEach((c, i) => c.setAttribute('data-jct-idx', String(i)));
		}
	}

	function refreshFavoritesUI() {
		JCT.state.isReordering = true;
		try {
			document.querySelectorAll('.jct-courses-grid').forEach(reorderContainerByFavorites);
			document.querySelectorAll('.jct-carousel-container').forEach(reorderContainerByFavorites);
		} finally {
			JCT.state.isReordering = false;
		}

		document.querySelectorAll('.jct-fav-toggle').forEach((btn) => {
			const card = btn.closest(CARD_CLOSEST_SELECTOR);
			const cid = card ? getCourseIdFromCard(card) : null;
			const fav = JCT.storage.isFavorite(cid);
			btn.classList.toggle('jct-fav-on', fav);
			btn.setAttribute('aria-pressed', fav ? 'true' : 'false');
			btn.textContent = fav ? '★' : '☆';
			if (card) card.setAttribute('data-jct-fav', fav ? '1' : '0');
		});
	}

	// Place the Moodle course search form cleanly at the top of the courses section
	function setupCourseSearchBox() {
		const body = document.body;
		if (!body || body.id !== 'page-site-index') return;

		const region = document.getElementById('region-main') || document.querySelector('#region-main, main');
		if (!region) return;

		const searchForm = region.querySelector(
			'form.simplesearchform[action*="course/search.php"], form.simplesearchform, form.coursesearch'
		);
		if (!searchForm) return;

		searchForm.classList.remove('jct-moved-bottom');
		searchForm.classList.add('jct-course-search-form');

		const courseList = document.getElementById('frontpage-course-list');
		if (!courseList) return;

		const coursesGrid = courseList.querySelector('.jct-courses-grid, .courses, .course-list');
		const heading = courseList.querySelector('h2');

		// Avoid moving if already positioned right before coursesGrid inside #frontpage-course-list
		if (searchForm.parentElement === courseList) return;

		const oldWrapper = searchForm.closest('.box.py-3, .coursesearchbox');

		JCT.state.isReordering = true;
		try {
			if (coursesGrid && coursesGrid.parentElement === courseList) {
				courseList.insertBefore(searchForm, coursesGrid);
			} else if (heading && heading.parentElement === courseList) {
				courseList.insertBefore(searchForm, heading.nextSibling);
			} else {
				courseList.insertBefore(searchForm, courseList.firstChild);
			}

			// Clean up now-empty old wrapper box (including an empty .simplesearchform div inside .box.py-3)
			if (
				oldWrapper &&
				oldWrapper !== region &&
				oldWrapper !== courseList &&
				oldWrapper.textContent.trim() === '' &&
				!oldWrapper.querySelector('input, button, a, img, form')
			) {
				oldWrapper.remove();
			}
		} finally {
			JCT.state.isReordering = false;
		}
	}

	function relocateTopBlocksAfterCourses() {
		const body = document.body;
		if (!body || body.id !== 'page-site-index') return;
		const region = document.getElementById('region-main') || document.querySelector('#region-main, main');
		if (!region) return;
		const coursesGrid = region.querySelector('.jct-courses-grid');
		if (!coursesGrid) return;

		const candidates = new Set();
		region.querySelectorAll('.course-content .sitetopic').forEach((el) => {
			candidates.add(el.closest('.card, .box, section, .content, div') || el);
		});

		let hero = null;
		let maxArea = 0;
		region.querySelectorAll('img').forEach((img) => {
			if (img.closest('.jct-courses-grid')) return;
			const w = img.naturalWidth || img.width || 0;
			const h = img.naturalHeight || img.height || 0;
			const area = w * h;
			if (area > maxArea && (w >= 600 || h >= 180)) {
				hero = img;
				maxArea = area;
			}
		});
		if (hero) candidates.add(hero.closest('.card, .box, section, .content, div') || hero);

		candidates.forEach((el) => {
			if (!el || el.classList.contains('jct-moved-bottom')) return;
			if (el.contains(coursesGrid)) return;
			// Never relocate the course search box
			if (el.matches('.simplesearchform, .jct-course-search-form') || el.querySelector('.simplesearchform, .jct-course-search-form')) {
				return;
			}
			region.appendChild(el);
			el.classList.add('jct-moved-bottom');
		});
	}

	function hideFrontClutter() {
		// Remove the Moodle frontpage banner image (Banner_Moodle.png) and its wrapper
		document.querySelectorAll('img[src*="Banner_Moodle"], img[alt*="מודל JCT"]').forEach((img) => {
			const wrapper = img.closest('div[align="center"], .jct-moved-bottom, p');
			if (wrapper && !wrapper.querySelector('#frontpage-course-list, .jct-courses-grid, #region-main')) {
				wrapper.remove();
			} else {
				img.remove();
			}
		});

		document.querySelectorAll('.box.py-3').forEach((box) => {
			if (
				box.classList.contains('d-flex') &&
				box.classList.contains('justify-content-center') &&
				box.children.length === 0
			) {
				box.remove();
			}
		});
	}

	function applyCoursePageColors() {
		const body = document.body;
		if (!body) return;
		const isCoursePage = body.classList.contains('pagelayout-course');
		const isInCoursePage = body.classList.contains('pagelayout-incourse');
		if (!isCoursePage && !isInCoursePage) return;

		let courseName = '';
		const breadcrumbCourseLink = document.querySelector(
			'.breadcrumb a[href*="/course/view.php"], nav[aria-label] a[href*="/course/view.php"]'
		);
		if (breadcrumbCourseLink) {
			courseName = (breadcrumbCourseLink.getAttribute('title') || breadcrumbCourseLink.textContent || '').trim();
		}

		if (isCoursePage) {
			const pageTitle = document.querySelector('.page-header-headings h1, #page-header h1, .page-context-header h1');
			if (pageTitle && pageTitle.textContent.trim()) {
				courseName = pageTitle.textContent.trim();
			}
		} else if (!courseName) {
			const pageTitle = document.querySelector('.page-header-headings h1, #page-header h1, .page-context-header h1');
			if (pageTitle) courseName = pageTitle.textContent.trim();
		}

		const { semIdx } = parseHebrewYearAndSemester(courseName);
		const color = colorFor(semIdx);

		document.documentElement.style.setProperty('--jct-course-h', String(color.h));
		document.documentElement.style.setProperty('--jct-course-s', `${color.s}%`);
		document.documentElement.style.setProperty('--jct-course-l', `${color.l}%`);

		if (color.isYearly && color.secondary) {
			document.documentElement.classList.add('jct-course-yearly');
			document.documentElement.style.setProperty('--jct-course-2-h', String(color.secondary.h));
			document.documentElement.style.setProperty('--jct-course-2-s', `${color.secondary.s}%`);
			document.documentElement.style.setProperty('--jct-course-2-l', `${color.secondary.l}%`);
		} else {
			document.documentElement.classList.remove('jct-course-yearly');
			document.documentElement.style.removeProperty('--jct-course-2-h');
			document.documentElement.style.removeProperty('--jct-course-2-s');
			document.documentElement.style.removeProperty('--jct-course-2-l');
		}

		document.documentElement.classList.add('jct-course-page-themed');
	}

	// Apply semester accent colors & clean noimg detection to /my/courses.php (block_myoverview) cards
	function styleMyCoursesCards() {
		const cards = document.querySelectorAll(
			'.block_myoverview .course-card, .block_myoverview .course-listitem, .block_myoverview .course-summaryitem'
		);
		if (cards.length === 0) return;

		cards.forEach((card) => {
			const text = card.innerText || card.textContent || '';
			const { semIdx } = parseHebrewYearAndSemester(text);
			const color = colorFor(semIdx);

			card.style.setProperty('--jct-accent-h', String(color.h));
			card.style.setProperty('--jct-accent-s', `${color.s}%`);
			card.style.setProperty('--jct-accent-l', `${color.l}%`);

			if (color.isYearly && color.secondary) {
				card.classList.add('jct-course-yearly');
				card.style.setProperty('--jct-accent-2-h', String(color.secondary.h));
				card.style.setProperty('--jct-accent-2-s', `${color.secondary.s}%`);
				card.style.setProperty('--jct-accent-2-l', `${color.secondary.l}%`);
			} else {
				card.classList.remove('jct-course-yearly');
				card.style.removeProperty('--jct-accent-2-h');
				card.style.removeProperty('--jct-accent-2-s');
				card.style.removeProperty('--jct-accent-2-l');
			}

			const cover = card.querySelector('.card-img-top');
			if (cover) {
				const bg = cover.style.backgroundImage || '';
				const isPlaceholder = !bg || bg === 'none' || bg.includes('/noimg') || bg.includes('noimg');
				card.classList.toggle('jct-mycourse-noimg', isPlaceholder);
			}
		});
	}

	JCT.courses = {
		applyCardStyle,
		applyViewMode,
		initializeCarouselView,
		restoreOriginalCourses,
		removeUnwantedCourses,
		markCoursesContainers,
		ensureStructureAndColor,
		styleMyCoursesCards,
		reorderContainerByFavorites,
		refreshFavoritesUI,
		setupCourseSearchBox,
		relocateTopBlocksAfterCourses,
		hideFrontClutter,
		applyCoursePageColors
	};
})(window.JCT = window.JCT || {});
