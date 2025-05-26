// timedropper.js
// author : Felice Gattuso, Zhenyu Wu
// license : MIT
// https://adam5wu.github.io/TimeDropper-Ex/
(function (factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define(['jquery', 'moment'], factory);
	} else if (typeof module === 'object' && module.exports) {
		// CommonJS. Register as a module
		module.exports = factory(require('jquery'), require('moment'));
	} else {
		// Browser globals
		factory(jQuery, moment);
	}
}
	(function ($) {
		'use strict';
		$.TDExLang = $.extend({
			'default': 'en',
			'en': {
				'am': 'AM',
				'pm': 'PM',
				'reset': 'Reset'
			}
		}, $.TDExLang);

		const ONE_MINUTE = 60;
		const ONE_HOUR = 60 * ONE_MINUTE;
		const HALF_HOUR = ONE_HOUR / 2;
		const ONE_DAY = 24 * ONE_HOUR;
		const HALF_DAY = ONE_DAY / 2;
		const FULL_CIRCLE = 360;
		const HALF_CIRCLE = FULL_CIRCLE / 2;

		$.fn.timeDropper = function (opt) {
			opt = $.extend({
				inline: false,
				autoStart: false,
				alwaysOpen: false,
				alwaysDial: false,
				dropTrigger: true,
				watchValueChange: true,
				format: 'hh:mm A',
				language: undefined,
				fetchTime: function () {
					return $(this).val();
				},
				putTime: function (s) {
					if (s != $(this).val())
						$(this).val(s).change();
				},
				autoSwitch: 2,
				hourCycle: undefined,
				mousewheel: true,
				showTicks: true,
				animation: "drop",
				container: undefined,
				startFrom: "hr",
				handleShake: false,
				stickyMinute: 15,
				stickyHour: 5 * ONE_MINUTE,
				range: undefined,
			}, opt);

			if (opt.alwaysOpen) {
				opt.autoStart = true;
				opt.dropTrigger = false;
			}

			var state = {
				anchor: $(this),
				wrapper: undefined,
				el: {},

				locale: 'default',
				localizer: {},
				fblocalizer: {},
				formatter: moment(),
				hourCycle: null,

				dialing: false,
				handleShake: null,
				followTime: null,
				dialDelay: null,

				selector: null,
				time: undefined,
				bound_hint: null,
				range: null,
				h_deg: 0,
				m_deg: 0,
				pm: false,
				select_deg: 0,

				init_deg: undefined,
				rad2deg: HALF_CIRCLE / Math.PI,
				center: undefined,

				active: false
			};

			// Public APIs
			state.anchor.data('TDEx', {
				show: function (t) {
					statusCheck();
					return start(t);
				},
				hide: function () {
					statusCheck();
					return stop();
				},
				select: function (sel) {
					statusCheck(true);
					switch (sel) {
						case 'hr':
							dialSelector(state.el.time_hr);
							break;
						case 'min':
							dialSelector(state.el.time_min);
							break;
						default:
							dialSelector(null);
					}
				},
				getTime: function () {
					statusCheck(true);
					var
						h = Math.floor((state.time / ONE_HOUR) + (state.time < 0 ? 24 : 0)),
						hs = (state.time % ONE_HOUR) + (state.time < 0 ? ONE_HOUR : 0),
						m = Math.floor(hs / ONE_MINUTE);
					return [state.time, formatTime(h, m, hs % ONE_MINUTE)];
				},
				isActive: function () {
					statusCheck();
					return state.active;
				},
				isDialing: function () {
					statusCheck();
					return state.dialing;
				},
				setTime: function (time, keepSelector) {
					resetClock(time);
					if (!keepSelector && !opt.alwaysDial)
						dialSelector(null);
					return time;
				},
				setTimeText: function (time) {
					statusCheck(true);

					var t = parseTime(time);
					return (t instanceof Date || !isNaN(t)) ? setClock(t) : t;
				},
				updateBound: function (lower, upper) {
					if (state.wrapper) {
						if (!state.bound) throw new Error('Not created with bound support');
						if (lower < -ONE_DAY || lower > ONE_DAY) throw new Error('Invalid lower bound');
						if (upper < -ONE_DAY || upper > ONE_DAY) throw new Error('Invalid upper bound');

						const range = upper - lower;
						if (range < 0) throw new Error('Invalid bound range');
						const range_sentinel = (range > ONE_HOUR) ? HALF_HOUR : (range / 2);
						state.bound = [lower, upper, range_sentinel, _boundRotate(lower, upper)];
						setClock(state.time);
					}
				},
				wrapper: function () {
					statusCheck(true);
					return state.wrapper;
				},
				anchor: function () {
					statusCheck();
					return state.anchor;
				},
				destroy: function () {
					statusCheck();

					state.anchor.trigger('TDEx-destroy', {});

					state.anchor.off('click', event_clickDrop);
					state.anchor.data('TDEx', undefined);

					if (state.wrapper)
						state.wrapper.remove();
					state.wrapper = null;

					$(document).off('click', event_clickUndrop);
					$(document).off('click', event_clickNoDialSelector);
				}
			});

			if (opt.dropTrigger)
				state.anchor.on('click', event_clickDrop);
			if (opt.autoStart)
				setTimeout(start.bind(this), 0);
			return this;

			function _boundRotate(range_start, range_end) {
				// Pre-compute rotation data for bounds
				const normStart = (range_start % ONE_DAY) + (range_start < 0 ? ONE_DAY : 0);
				const lancetteStart = lancetteData(normStart);
				const normEnd = (range_end % ONE_DAY) + (range_end < 0 ? ONE_DAY : 0);
				const lancetteEnd = lancetteData(normEnd);

				return {
					lower: [lancetteStart.h_deg, lancetteStart.m_deg],
					upper: [lancetteEnd.h_deg, lancetteEnd.m_deg]
				};
			}

			function _init() {
				// Check if range is specified.
				if (opt.range) {
					const range_start = Math.round(opt.range.start);
					const range_len = Math.round(opt.range.length);
					const range_end = range_start + range_len;

					if (range_len < 0 || range_len > ONE_DAY) throw new Error('Invalid range length');
					if (range_start < -ONE_DAY || range_start > ONE_DAY) throw new Error('Invalid range start');
					if (range_start < 0 && range_end <= 0)
						throw new Error(`Use positive range start (${range_start + ONE_DAY}) instead.`);
					if (range_start + range_len > ONE_DAY)
						throw new Error(`Use negative range start (${range_start - ONE_DAY}) instead.`);
					if (!isNaN(opt.range.init) && (opt.range.init < range_start || opt.range.init > range_end))
						throw new Error('Invalid range init time');

					const range_sentinel = (range_len > ONE_HOUR) ? HALF_HOUR : (range_len / 2);
					state.bound = [range_start, range_end, range_sentinel, _boundRotate(range_start, range_end)];
				}

				// Initialize locale
				var localizer = ResolveLocalizer(state.locale)
				var fblocale = localizer[0];
				state.fblocalizer = localizer[1];

				var locale = state.locale;
				if (!opt.language) {
					var languages = navigator.languages || navigator.userLanguage ||
						(navigator.language ? [navigator.language] : [navigator.browserLanguage]);
					for (var idx in languages) {
						var lang = languages[idx].toLowerCase();
						if (lang in $.TDExLang) {
							locale = lang;
							break;
						}
					}
				} else if (opt.language in $.TDExLang)
					locale = opt.language;

				localizer = ResolveLocalizer(locale);
				state.locale = localizer[0];
				state.localizer = localizer[1];

				var _locale = state.formatter.locale();
				if (!opt.language || state.formatter.locale(opt.language).locale() !== opt.language) {
					if (state.formatter.locale(state.locale).locale() !== state.locale)
						if (state.formatter.locale(locale).locale() !== locale)
							if (state.formatter.locale(fblocale).locale() !== fblocale)
								state.formatter.locale(_locale);
				}
				// Set formatter to a clean state (bypass daylight saving problem)
				state.formatter.utc().startOf('day');

				const sys_locale = new Intl.DateTimeFormat().resolvedOptions().locale;
				state.hourCycle = opt.hourCycle || new Intl.Locale(sys_locale).getHourCycles()[0];

				state.wrapper = createDom($('.td-clock').length);
				(opt.container || $('body')).append(state.wrapper);

				state.el['ticks'] = state.wrapper.find('.td-clock-face line');
				state.el['bound_hint'] = state.wrapper.find('.td-bound');
				state.el['bound_hr'] = state.wrapper.find('.td-bound.td-hr');
				state.el['bound_min'] = state.wrapper.find('.td-bound.td-min');
				state.el['pointer'] = state.wrapper.find('.td-pointer');
				state.el['pointer_hr'] = state.wrapper.find('.td-pointer.td-hr');
				state.el['pointer_min'] = state.wrapper.find('.td-pointer.td-min');
				state.el['hr'] = state.wrapper.find('.td-hr');
				state.el['min'] = state.wrapper.find('.td-min');
				state.el['dial'] = state.wrapper.find('.td-dial');
				state.el['dial_handle'] = state.el.dial.find('.td-handle');
				state.el['dial_rail'] = state.el.dial.find('svg');
				state.el['meridian'] = state.wrapper.find('.td-meridian');
				state.el['meridian_spans'] = state.el.meridian.find('span');
				state.el['meridian_am'] = state.el.meridian.find('.td-am');
				state.el['meridian_pm'] = state.el.meridian.find('.td-pm');
				state.el['meridian_now'] = state.el.meridian.find('.td-now');
				state.el['time'] = state.wrapper.find('.td-time');
				state.el['time_spans'] = state.el.time.find('span');
				state.el['time_hr'] = state.el.time.find('.td-hr');
				state.el['time_min'] = state.el.time.find('.td-min');

				if (opt.hideTicks) state.el.lancet.css('display', 'none');
				if (!opt.dropTrigger) state.wrapper.addClass('nodrop');

				state.wrapper.attr('unselectable', 'on')
					.css('user-select', 'none')
					.bind('selectstart', function (e) {
						e.preventDefault();
						return false;
					});

				state.el.time_spans.on('click', event_clickDialSelector);
				if (!opt.alwaysOpen)
					state.wrapper.on('click', event_clickNoDialSelector);
				if (!state.bound) {
					state.el.meridian_am.addClass('interactive');
					state.el.meridian_am.on('click', event_clickMeridianAMPM);
					state.el.meridian_pm.addClass('interactive');
					state.el.meridian_pm.on('click', event_clickMeridianAMPM);
					state.el.meridian_now.addClass('interactive');
					state.el.meridian_now.on('click', event_clickMeridianReset);
				}

				state.el.dial_rail.on('touchstart mousedown', event_startRail);
				if (opt.mousewheel)
					state.wrapper.on('mousewheel', event_wheel);
			}

			function statusCheck(initialized) {
				if (!state.wrapper) {
					if (state.wrapper !== undefined)
						throw new Error('Already destroyed');
					if (initialized)
						throw new Error('Not yet initialized');
				}
			}

			function ResolveLocalizer(locale) {
				var localizer = $.TDExLang[locale];
				// Resolve aliases
				while (localizer.constructor === String) {
					locale = localizer;
					localizer = $.TDExLang[localizer];
				}
				return [locale, localizer];
			}

			function localize(t) {
				return state.localizer[t] || state.fblocalizer[t] || '??';
			}

			function displayNumber(n) {
				return n < 10 ? '0' + n : n
			}

			function parseTime(data) {
				var val = (typeof data == 'string' || data instanceof String) ? data.trim() : undefined;
				if (val) {
					var parsed = moment(val, opt.format, state.formatter.locale(), true);
					val = parsed.isValid() ? parsed.utc().toDate() : undefined;
				}
				return val;
			}

			function formatTime(h, m, s) {
				state.formatter.hour(h).minute(m).second(s);
				return state.formatter.format(opt.format);
			}

			function lancetteData(normT) {
				const
					h = Math.floor(normT / ONE_HOUR),
					hs = normT % ONE_HOUR,
					m = Math.floor(hs / ONE_MINUTE),
					m_deg = hs * FULL_CIRCLE / ONE_HOUR,
					h_deg = h * FULL_CIRCLE / 12;

				return {
					h: h, m: m, s: hs % ONE_MINUTE, pm: h >= 12,
					h_deg: h_deg % FULL_CIRCLE + m_deg / 12, m_deg: m_deg,
				};
			}

			function progressTo(pos, bound, len) {
				if (pos == bound || !len) return 1;
				if (pos < bound) {
					if (pos < bound - len) return 0;
					return (pos - bound + len) / len;
				} else {
					if (pos > bound + len) return 0;
					return (bound + len - pos) / len;
				}
			}

			function setClock(t, annotation) {
				var note = $.extend({}, annotation);

				var Update = false;
				var BoundHint = 0;
				if (state.bound) {
					t = Math.max(state.bound[0], Math.min(state.bound[1], t));
					if (note.rotateFwd === true) {
						BoundHint = progressTo(t, state.bound[1], state.bound[2])
							|| -progressTo(t, state.bound[0], state.bound[2] / 2);
					} else if (note.rotateFwd === false) {
						BoundHint = -progressTo(t, state.bound[0], state.bound[2])
							|| progressTo(t, state.bound[1], state.bound[2] / 2);
					} else {
						BoundHint = -progressTo(t, state.bound[0], state.bound[2] / 2)
							|| progressTo(t, state.bound[1], state.bound[2] / 2);
					}
					Update = state.time != t || state.bound_hint != BoundHint;
				} else {
					Update = state.time != t;
					if (!note.isNow && state.followTime) {
						clearInterval(state.followTime);
						state.followTime = null;
						state.el.meridian_now.addClass('td-on');
						Update = true;
					}
				}

				if (Update) {
					const normT = (t % ONE_DAY) + (t < 0 ? ONE_DAY : 0);
					const lancette = lancetteData(normT);
					state.el.pointer_hr.css('transform', 'rotate(' + lancette.h_deg + 'deg)');
					state.el.pointer_min.css('transform', 'rotate(' + lancette.m_deg + 'deg)');

					var disp_h = lancette.h;
					switch (state.hourCycle) {
						case "h11": disp_h = (disp_h > 12) ? (disp_h - 12) : disp_h; break;
						case "h12": disp_h = (disp_h > 12) ? (disp_h - 12) : (disp_h || 12); break;
						case "h23": disp_h = disp_h; break;
						case "h24": disp_h = disp_h || 24; break;
					}
					state.el.time_hr.attr('data-id', lancette.h).text(displayNumber(disp_h));
					state.el.time_min.attr('data-id', lancette.m).text(displayNumber(lancette.m));

					if (state.hourCycle == 'h11' || state.hourCycle == 'h12') {
						if (lancette.pm) {
							state.el.meridian_am.removeClass('td-on');
							state.el.meridian_pm.addClass('td-on');
						} else {
							state.el.meridian_am.addClass('td-on');
							state.el.meridian_pm.removeClass('td-on');
						}
					}

					if (BoundHint) {
						var boundDeg;
						if (BoundHint > 0) {
							state.el.bound_hint.addClass('upper').removeClass('lower');
							boundDeg = state.bound[3].upper;
						} else {
							state.el.bound_hint.addClass('lower').removeClass('upper');
							boundDeg = state.bound[3].lower;
						}
						state.el.bound_hr.css('transform', 'rotate(' + boundDeg[0] + 'deg)');
						state.el.bound_min.css('transform', 'rotate(' + boundDeg[1] + 'deg)');
						state.el.bound_hint.css('opacity', Math.abs(BoundHint) * 0.6);
					} else {
						// Keep the class for smoother transition
						// state.el.bound_hint.removeClass('upper lower');
						state.el.bound_hint.css('opacity', 0);
					}

					if (state.selector) {
						if (state.selector.hasClass('td-hr')) {
							state.el.dial.css('transform', 'rotate(' + lancette.h_deg + 'deg)');
						} else {
							state.el.dial.css('transform', 'rotate(' + lancette.m_deg + 'deg)');
						}
					}

					state.bound_hint = BoundHint;
					state.h_deg = lancette.h_deg;
					state.m_deg = lancette.m_deg;
					state.pm = lancette.pm;

					const newT = state.bound ? t : normT;
					if (state.time != newT) {
						state.time = newT;
						var str_time = formatTime(lancette.h, lancette.m, lancette.s);
						opt.putTime.call(state.anchor[0], str_time);
						state.anchor.trigger('TDEx-update', {
							dialing: state.dialing,
							selector: state.selector ? (state.selector.hasClass('td-hr') ? 'hr' : 'min') : null,
							now: note.isNow,
							time: [state.time, str_time]
						});
					}
				}
			}

			function rotateMin(deg) {
				var
					hs = state.time % ONE_HOUR,
					newhs = Math.round(deg * ONE_HOUR / FULL_CIRCLE);
				// In case of time-bound mode
				if (hs < 0) hs += ONE_HOUR;

				if (opt.stickyMinute > 1) {
					var
						fs = newhs % ONE_MINUTE,
						bs = ONE_MINUTE - fs;
					if ((fs < opt.stickyMinute) || (bs < opt.stickyMinute)) {
						newhs = (newhs - fs + (fs < opt.stickyMinute ? 0 : ONE_MINUTE)) % ONE_HOUR;
						deg = newhs * FULL_CIRCLE / ONE_HOUR;
					}
					if (deg == state.m_deg)
						return;
				}

				var
					fwddeg = (deg > state.m_deg) ? (deg - state.m_deg) : (state.m_deg - deg),
					epochhs = (fwddeg <= HALF_CIRCLE) ? 0 : (deg < state.m_deg ? ONE_HOUR : -ONE_HOUR),
					timeadj = newhs - hs + epochhs;

				if (timeadj) setClock(state.time + timeadj, { rotateFwd: timeadj > 0 });
			}

			function rotateHr(deg) {
				var
					pt = state.time % HALF_DAY,
					newt = Math.round(deg * HALF_DAY / FULL_CIRCLE);
				// In case of time-bound mode
				if (pt < 0) pt += HALF_DAY;

				if (opt.stickyHour > 1) {
					var
						fs = newt % ONE_HOUR,
						bs = ONE_HOUR - fs;
					if ((fs < opt.stickyHour) || (bs < opt.stickyHour)) {
						newt = (newt - fs + (fs < opt.stickyHour ? 0 : ONE_HOUR)) % HALF_DAY;
						deg = newt * FULL_CIRCLE / HALF_DAY;
					}
					if (deg == state.h_deg)
						return;
				}

				var
					fwddeg = (deg > state.h_deg) ? (deg - state.h_deg) : (state.h_deg - deg),
					epochhs = (fwddeg <= HALF_CIRCLE) ? 0 : (deg < state.h_deg ? HALF_DAY : -HALF_DAY),
					timeadj = newt - pt + epochhs;

				if (timeadj) setClock(state.time + timeadj, { rotateFwd: timeadj > 0 });
			}

			function dialSelector(comp) {
				state.selector = comp;
				if (state.selector) {
					if (state.selector.hasClass('td-hr')) {
						state.el.hr.addClass('td-on');
						state.el.min.removeClass('td-on');
						state.select_deg = state.h_deg;
					} else {
						state.el.hr.removeClass('td-on');
						state.el.min.addClass('td-on');
						state.select_deg = state.m_deg;
					}
					state.el.dial.addClass('td-n');
					state.el.dial.addClass('active');
					state.el.dial.css('transform', 'rotate(' + state.select_deg + 'deg)');

					if (opt.handleShake && state.handleShake == null) {
						state.handleShake = setInterval(function () {
							state.el.dial_handle.addClass('td-bounce');
							setTimeout(function () {
								state.el.dial_handle.removeClass('td-bounce');
							}, 1000);
						}, 2000);
					}
				} else {
					state.el.hr.removeClass('td-on');
					state.el.min.removeClass('td-on');
					state.el.dial.removeClass('active');

					if (state.handleShake) {
						clearInterval(state.handleShake);
						state.handleShake = null;
					}
				}

				state.anchor.trigger('TDEx-selector', {
					selector: state.selector ? (state.selector.hasClass('td-hr') ? 'hr' : 'min') : null
				});
			}

			function event_clickDialSelector(e) {
				dialSelector($(this));

				if (state.dialDelay)
					clearTimeout(state.dialDelay);

				state.dialDelay = setTimeout(function () {
					state.dialDelay = null;
				}, 100);
			}

			function event_clickNoDialSelector(e) {
				if (state.dialDelay == null)
					dialSelector(null);
			}

			function event_clickMeridianAMPM(e) {
				if (state.bound) return;
				state.anchor.trigger('TDEx-meridian', {
					clicked: state.pm ? 'am' : 'pm'
				});
				var timeadj = HALF_DAY;
				setClock(state.time + timeadj);
			}

			function event_clickMeridianReset(e) {
				state.anchor.trigger('TDEx-meridian', {
					clicked: 'now'
				});
				resetClock(null);
			}

			function event_startRail(e) {
				if (state.selector) {
					e.preventDefault();

					state.anchor.trigger('TDEx-dialing', {
						finish: false,
						selector: (state.selector.hasClass('td-hr') ? 'hr' : 'min')
					});

					if (state.handleShake) {
						clearInterval(state.handleShake);
						state.handleShake = null;
					}

					state.el.dial.removeClass('td-n');
					state.el.dial_handle.removeClass('td-bounce');
					state.el.dial_handle.addClass('td-drag');

					state.dialing = true;

					var offset = state.wrapper.offset();
					state.center = {
						y: offset.top + state.wrapper.height() / 2,
						x: offset.left + state.wrapper.width() / 2
					};

					var
						move = (e.type == 'touchstart') ? e.originalEvent.touches[0] : e,
						a = state.center.y - move.pageY,
						b = state.center.x - move.pageX,
						deg = Math.atan2(a, b) * state.rad2deg;

					state.init_deg = (deg < 0) ? FULL_CIRCLE + deg : deg;

					$(window).on('touchmove mousemove', event_moveRail);
					$(window).on('touchend mouseup', event_stopRail);
				}
			}

			function event_moveRail(e) {
				// This prevent browser execute mouse drag or touch move action
				e.preventDefault();

				var
					move = (e.type == 'touchmove') ? e.originalEvent.touches[0] : e,
					a = state.center.y - move.pageY,
					b = state.center.x - move.pageX,
					deg = Math.atan2(a, b) * state.rad2deg;

				if (deg < 0)
					deg = FULL_CIRCLE + deg;

				var newdeg = (deg - state.init_deg) + state.select_deg;

				if (newdeg < 0)
					newdeg = FULL_CIRCLE + newdeg;
				else if (newdeg > FULL_CIRCLE)
					newdeg = newdeg - FULL_CIRCLE;

				if (state.selector.hasClass('td-hr'))
					rotateHr(newdeg);
				else
					rotateMin(newdeg);
			}

			function event_stopRail(e) {
				e.preventDefault();

				state.dialing = false;
				if (state.dialDelay)
					clearTimeout(state.dialDelay);
				state.dialDelay = setTimeout(function () {
					state.dialDelay = null;
				}, 100);

				if (opt.autoSwitch > 1 || state.selector.hasClass('td-hr')) {
					dialSelector(state.selector.hasClass('td-hr') ? state.el.time_min : state.el.time_hr);
				} else {
					state.select_deg = state.selector.hasClass('td-hr') ? state.h_deg : state.m_deg;
				}
				state.el.dial.addClass('td-n');
				state.el.dial_handle.addClass('td-bounce');
				state.el.dial_handle.removeClass('td-drag');

				$(window).off('touchmove mousemove', event_moveRail);
				$(window).off('touchend mouseup', event_stopRail);

				state.anchor.trigger('TDEx-dialing', {
					finish: true,
					selector: (state.selector.hasClass('td-hr') ? 'hr' : 'min')
				});
			}

			function event_wheel(e) {
				if (state.selector) {
					e.preventDefault();
					e.stopPropagation();

					if (state.handleShake) {
						clearInterval(state.handleShake);
						state.handleShake = null;
					}

					if (!state.dialing) {
						state.el.dial.removeClass('td-n');

						const rotateDelta = e.originalEvent.wheelDelta / 120;
						state.select_deg += rotateDelta;
						if (state.select_deg < 0)
							state.select_deg = FULL_CIRCLE + state.select_deg;
						else if (state.select_deg > FULL_CIRCLE)
							state.select_deg = state.select_deg - FULL_CIRCLE;

						if (state.selector.hasClass('td-hr')) {
							rotateHr(state.select_deg);
							if (state.bound) {
								if ((state.time == state.bound[0] && rotateDelta < 0) ||
									(state.time == state.bound[1] && rotateDelta > 0))
									state.select_deg = state.h_deg;
							}
						} else {
							rotateMin(state.select_deg);
							if (state.bound) {
								if ((state.time == state.bound[0] && rotateDelta < 0) ||
									(state.time == state.bound[1] && rotateDelta > 0))
									state.select_deg = state.m_deg;
							}
						}
					}
				}
			}

			function resetClock(t) {
				var newt;
				if (typeof t == 'number' || t instanceof Number || t instanceof Date) {
					if (state.followTime && !state.bound) {
						clearInterval(state.followTime);
						state.followTime = null;
						state.el.meridian_now.addClass('td-on');
					}

					newt = t instanceof Date ? t.getHours() * ONE_HOUR + t.getMinutes() * ONE_MINUTE + t.getSeconds() : t;
				} else {
					if (state.followTime) return;

					if (state.bound) newt = 0;
					else {
						state.followTime = setInterval(function () {
							const now = new Date();
							newt = now.getHours() * ONE_HOUR + now.getMinutes() * ONE_MINUTE + now.getSeconds();
							setClock(newt, { isNow: true });
						}, 500);
						state.el.meridian_now.removeClass('td-on');

						const now = new Date();
						newt = now.getHours() * ONE_HOUR + now.getMinutes() * ONE_MINUTE + now.getSeconds();
					}
				}

				if (typeof newt == 'number' && newt != state.time) {
					state.el.pointer.addClass('td-n');
					setClock(newt, { isNow: state.followTime !== null });
					state.anchor.trigger('TDEx-reset', {
						sourceTime: t
					});
					setTimeout(function () {
						state.el.pointer.removeClass('td-n');
					}, 500);
				}
			}

			function calcPosition() {
				var anchorO = state.anchor.offset();
				var anchorW = state.anchor.outerWidth();
				var anchorH = state.anchor.outerHeight();
				anchorO['right'] = anchorO.left + anchorW;
				anchorO['bottom'] = anchorO.top + anchorH;
				var containerO = state.wrapper.offset();
				var containerW = state.wrapper.outerWidth();
				var containerH = state.wrapper.outerHeight();
				containerO['right'] = containerO.left + containerW;
				containerO['bottom'] = containerO.top + containerH;
				var vpO = {
					top: $(window).scrollTop(),
					left: $(window).scrollLeft()
				};
				var vpW = $(window).width();
				var vpH = $(window).height();
				vpO['right'] = vpO.left + vpW;
				vpO['bottom'] = vpO.top + vpH;

				var anchorCenter = Math.round(anchorO.left + (anchorW - containerW) / 2);
				if ((containerO.left == anchorCenter) &&
					(containerO.top >= vpO.top && containerO.bottom <= vpO.bottom) &&
					(containerO.top == anchorO.bottom || containerO.bottom == anchorO.top))
					return false;

				var DropDown = (anchorO.bottom + containerH <= vpO.bottom) || (anchorO.top - containerH < vpO.top);
				var VDist;
				if (DropDown) {
					var newTop = Math.max(anchorO.bottom, vpO.top);
					state.wrapper.removeClass('drop-up').css({
						top: newTop,
						bottom: 'auto',
						left: anchorCenter
					});
					VDist = newTop - anchorO.bottom;
				} else {
					var bodyH = $('body').outerHeight();
					var newBotTop = Math.min(anchorO.top, vpO.bottom);
					state.wrapper.addClass('drop-up').css({
						top: 'auto',
						bottom: bodyH - newBotTop,
						left: anchorCenter
					});
					VDist = anchorO.top - newBotTop;
				}
				state.wrapper.css({
					opacity: 0.3 + 0.7 / Math.log2(2 + (VDist >> 7))
				});
				return true;
			}

			function event_resizeScroll(e) {
				calcPosition();
			}

			function start(t) {
				if (!state.active) {
					if (!state.wrapper)
						_init();

					state.active = true;

					state.wrapper.addClass('td-show')
						.removeClass('td-' + opt.animation + 'out');
					if (!opt.alwaysOpen)
						state.wrapper.addClass('td-' + opt.animation + 'in');

					resetClock(typeof t == 'number' || t instanceof Number || t instanceof Date
						? t
						: ((opt.range && !isNaN(opt.range.init))
							? opt.range.init
							: parseTime(opt.fetchTime.call(state.anchor[0]))));

					switch (opt.startFrom) {
						case 'hr':
							dialSelector(state.el.time_hr);
							break;
						case 'min':
							dialSelector(state.el.time_min);
							break;
					}

					if (!opt.container) {
						calcPosition();
						$(window).on('resize scroll', event_resizeScroll);
					}

					if (opt.watchValueChange)
						state.anchor.on('input', event_valueChange);

					if (!opt.alwaysDial) {
						$(document).on('click', opt.alwaysOpen ? event_clickNoDialSelector : event_clickUndrop);
					}

					state.anchor.trigger('TDEx-show', {});
					return true;
				}
				return false;
			}

			function stop() {
				if (!opt.alwaysOpen && state.active) {
					state.active = false;

					if (state.followTime) {
						clearInterval(state.followTime);
						state.followTime = null;
						state.el.meridian_now.addClass('td-on');
					}

					if (state.handleShake) {
						clearInterval(state.handleShake);
						state.handleShake = null;
					}

					if (!opt.container) {
						$(window).off('resize', event_resizeScroll);
						$(window).off('scroll', event_resizeScroll);
					}

					if (opt.watchValueChange)
						state.anchor.off('input', event_valueChange);

					$(document).off('click', event_clickUndrop);

					setTimeout(function () {
						dialSelector(null);
						state.wrapper.removeClass('td-show')
						state.anchor.trigger('TDEx-hide', {});
					}, 700);

					state.wrapper
						.addClass('td-' + opt.animation + 'out')
						.removeClass('td-' + opt.animation + 'in');
					return true;
				}
				return false;
			}

			function clickContained(evt, container) {
				return container.contains(evt.target) || evt.target == container;
			}

			function event_valueChange(e) {
				if (state.followTime) {
					clearInterval(state.followTime);
					state.followTime = null;
					state.el.meridian_now.addClass('td-on');
				}
				clearTimeout(state.valueChange);
				state.valueChange = setTimeout(function () {
					state.valueChange = null;
					var time = parseTime(opt.fetchTime.call(state.anchor[0]));
					if (time) resetClock(time);
				}, 500);
			}

			function event_clickDrop(e) {
				start();
			}

			function event_clickUndrop(e) {
				if (clickContained(e, state.anchor[0])) return;
				if (clickContained(e, state.wrapper[0])) return;
				if (state.dialDelay) return;  // Just finished dialing.
				stop();
			}

			function tagGen(name, attrs, content) {
				var Ret = '<' + name;
				if (attrs) {
					$.each(attrs, function (attrKey, attrVal) {
						if (attrVal instanceof Array)
							attrVal = attrVal.reduce(function (t, e) {
								return (t || '') + (e ? ' ' + e : '');
							});
						Ret += ' ' + attrKey + '="' + attrVal + '"';
					});
					Ret += (content === undefined) ? '/' : ('>' + content + '</' + name);
				}
				return Ret + '>';
			}

			function createDom(index) {
				var html =
					tagGen('div', {
						class: ['td-clock', (opt.inline ? 'inline' : '')],
						id: 'td-clock-' + index
					}, tagGen('div', { class: 'td-clock-wrap' },
						tagGen('div', { class: 'td-clock-face' },
							(!opt.range ? ''
								: tagGen('div', { class: ['td-bound', 'td-hr'] }, '')
								+ tagGen('div', { class: ['td-bound', 'td-min'] }, ''))
							+ tagGen('svg', { viewBox: '4 4 92 92', },
								tagGen('circle', { fill: 'none', cx: '50', cy: '50', r: '45' })
								+ (!opt.showTicks ? ''
									: tagGen('line', { x1: 50.00, y1: 5.000, x2: 50.00, y2: 12.00, class: 'td-tick-key' })
									+ tagGen('line', { x1: 72.50, y1: 11.03, x2: 70.00, y2: 15.36 })
									+ tagGen('line', { x1: 88.97, y1: 27.50, x2: 84.64, y2: 30.00 })
									+ tagGen('line', { x1: 95.00, y1: 50.00, x2: 88.00, y2: 50.00, class: 'td-tick-key' })
									+ tagGen('line', { x1: 88.97, y1: 72.50, x2: 84.64, y2: 70.00 })
									+ tagGen('line', { x1: 72.50, y1: 88.97, x2: 70.00, y2: 84.64 })
									+ tagGen('line', { x1: 50.00, y1: 95.00, x2: 50.00, y2: 88.00, class: 'td-tick-key' })
									+ tagGen('line', { x1: 27.50, y1: 88.97, x2: 30.00, y2: 84.64 })
									+ tagGen('line', { x1: 11.03, y1: 72.50, x2: 15.36, y2: 70.00 })
									+ tagGen('line', { x1: 5.000, y1: 50.00, x2: 12.00, y2: 50.00, class: 'td-tick-key' })
									+ tagGen('line', { x1: 11.03, y1: 27.50, x2: 15.36, y2: 30.00 })
									+ tagGen('line', { x1: 27.50, y1: 11.03, x2: 30.00, y2: 15.36 }))
							)
						)
						+ tagGen('div', { class: 'td-meridian' },
							tagGen('span', { class: ['td-am', 'td-n2'] }, localize('am'))
							+ tagGen('span', { class: ['td-pm', 'td-n2'] }, localize('pm'))
							+ tagGen('span', { class: ['td-now', 'td-n2'] }, localize('reset')))
						+ tagGen('div', { class: 'td-lancette' },
							tagGen('div', { class: ['td-pointer', 'td-hr'] }, '')
							+ tagGen('div', { class: ['td-pointer', 'td-min'] }, ''))
						+ tagGen('div', { class: 'td-time' },
							tagGen('span', { class: ['td-hr', 'td-n2'] }, '')
							+ ':'
							+ tagGen('span', { class: ['td-min', 'td-n2'] }, ''))
						+ tagGen('div', { class: ['td-dial', 'td-n'] },
							tagGen('div', { class: 'td-handle' },
								tagGen('svg', { class: 'td-handle-hint', viewBox: '0 0 100 35.4', },
									tagGen('path', { fill: 'none', d: 'M98.1,33C85.4,21.5,68.5,14.5,50,14.5S14.6,21.5,1.9,33' }, '')
									+ tagGen('line', { x1: 1.9, y1: 33, x2: 1.9, y2: 26 }, '')
									+ tagGen('line', { x1: 1.9, y1: 33, x2: 8.9, y2: 33 }, '')
									+ tagGen('line', { x1: 98.1, y1: 33, x2: 91.1, y2: 33 }, '')
									+ tagGen('line', { x1: 98.1, y1: 33, x2: 98.1, y2: 26 }, '')
								)
							)
						)
					)
					);

				return $(html);
			}
		};
	}))
