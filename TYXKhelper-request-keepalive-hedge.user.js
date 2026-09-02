// ==UserScript==
// @name         霓裳体育选课助手 by Rinn
// @namespace    TYXKhelper
// @version      1.0.0
// @author       Rinn
// @description  TYXKhelper: prevent request timeout/cancel and hedge safe GET/HEAD requests on stuh5.chd.edu.cn
// @match        https://stuh5.chd.edu.cn/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  /*
   * ============================================================
   * Configuration
   * ============================================================
   */

  const TARGET_HOST = 'stuh5.chd.edu.cn';

  /*
   * 24 小时。
   *
   * 不使用 Infinity / Number.MAX_VALUE，
   * 避免浏览器内部定时器整数范围问题。
   */
  const LONG_TIMEOUT_MS =
    24 * 60 * 60 * 1000;

  /*
   * Hedged Request 参数：
   *
   * Request #1:
   *   立即发送
   *
   * Request #2:
   *   1500ms 后，如果还没有任何成功结果，
   *   再发送第二份。
   */
  const HEDGE_MAX_ATTEMPTS = 2;

  const HEDGE_DELAY_MS = 1500;

  /*
   * Webpack / uni 初始化检测间隔。
   */
  const PATCH_INTERVAL_MS = 10;

  /*
   * 最长持续尝试安装 60 秒。
   *
   * SPA 后续动态 chunk 通常在此之前已经加载。
   */
  const PATCH_WINDOW_MS = 60000;


  /*
   * ============================================================
   * Global guard
   * ============================================================
   */

  if (window.__TYXKHELPER_REQUEST_PATCH_V3__) {
    console.warn(
      '[TYXKhelper] V3 already installed'
    );

    return;
  }

  Object.defineProperty(
    window,
    '__TYXKHELPER_REQUEST_PATCH_V3__',
    {
      value: true,
      configurable: false,
      writable: false,
    }
  );


  /*
   * ============================================================
   * Helpers
   * ============================================================
   */

  function resolveUrl(rawUrl) {
    try {
      return new URL(
        String(rawUrl),
        location.href
      );
    } catch (_) {
      return null;
    }
  }


  function isTargetUrl(rawUrl) {
    const url = resolveUrl(rawUrl);

    return !!url &&
      url.hostname === TARGET_HOST;
  }


  function normalizeMethod(method) {
    return String(
      method || 'GET'
    ).toUpperCase();
  }


  function isSafeToHedge(method) {
    const m =
      normalizeMethod(method);

    return (
      m === 'GET' ||
      m === 'HEAD'
    );
  }


  function log(...args) {
    console.log(
      '[TYXKhelper]',
      ...args
    );
  }


  function warn(...args) {
    console.warn(
      '[TYXKhelper]',
      ...args
    );
  }


  function error(...args) {
    console.error(
      '[TYXKhelper]',
      ...args
    );
  }


  /*
   * ============================================================
   * 1. XMLHttpRequest
   *
   * - 记录 URL / method
   * - target domain timeout = 0
   * - 阻止 target domain abort()
   * ============================================================
   */

  const xhrMetadata =
    new WeakMap();

  const NativeXHROpen =
    XMLHttpRequest.prototype.open;

  const NativeXHRAbort =
    XMLHttpRequest.prototype.abort;


  XMLHttpRequest.prototype.open =
    function (
      method,
      url,
      ...rest
    ) {
      const info = {
        method:
          normalizeMethod(method),

        url:
          String(url),

        target:
          isTargetUrl(url),
      };

      xhrMetadata.set(
        this,
        info
      );


      if (info.target) {
        log(
          'XHR protected:',
          info.method,
          info.url
        );
      }


      return Reflect.apply(
        NativeXHROpen,
        this,
        [
          method,
          url,
          ...rest,
        ]
      );
    };


  /*
   * ============================================================
   * Block XHR.abort()
   * ============================================================
   */

  XMLHttpRequest.prototype.abort =
    function (...args) {
      const info =
        xhrMetadata.get(this);


      if (info?.target) {
        warn(
          'blocked XHR.abort():',
          info.method,
          info.url
        );

        return;
      }


      return Reflect.apply(
        NativeXHRAbort,
        this,
        args
      );
    };


  /*
   * ============================================================
   * Disable native XHR timeout
   *
   * xhr.timeout = 0
   *
   * 表示浏览器原生 XHR 不主动超时。
   * ============================================================
   */

  try {
    const descriptor =
      Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype,
        'timeout'
      );


    if (
      descriptor?.get &&
      descriptor?.set
    ) {
      Object.defineProperty(
        XMLHttpRequest.prototype,
        'timeout',
        {
          configurable: true,

          enumerable:
            descriptor.enumerable,

          get() {
            return Reflect.apply(
              descriptor.get,
              this,
              []
            );
          },

          set(value) {
            const info =
              xhrMetadata.get(this);


            if (info?.target) {
              warn(
                'blocked XHR.timeout:',
                value,
                '→ 0',
                info.method,
                info.url
              );


              return Reflect.apply(
                descriptor.set,
                this,
                [0]
              );
            }


            return Reflect.apply(
              descriptor.set,
              this,
              [value]
            );
          },
        }
      );
    }
  } catch (e) {
    error(
      'failed to patch XHR.timeout:',
      e
    );
  }


  /*
   * ============================================================
   * 2. fetch()
   *
   * 对目标域名移除网站自己的 AbortSignal。
   *
   * 页面：
   *
   * fetch(url, {
   *   signal: controller.signal
   * })
   *
   * 实际：
   *
   * fetch(url, {
   *   signal: ourSignal
   * })
   *
   * 因此页面 controller.abort()
   * 不再能终止真正的网络请求。
   * ============================================================
   */

  if (typeof window.fetch === 'function') {
    const NativeFetch =
      window.fetch.bind(window);


    window.fetch =
      function (
        input,
        init = {}
      ) {
        let requestUrl = '';

        let method = 'GET';


        if (
          typeof input === 'string' ||
          input instanceof URL
        ) {
          requestUrl =
            String(input);

          method =
            normalizeMethod(
              init?.method
            );
        } else if (
          typeof Request !== 'undefined' &&
          input instanceof Request
        ) {
          requestUrl =
            input.url;

          method =
            normalizeMethod(
              init?.method ||
              input.method
            );
        }


        if (
          !isTargetUrl(requestUrl)
        ) {
          return NativeFetch(
            input,
            init
          );
        }


        const controller =
          new AbortController();


        const safeInit = {
          ...init,

          signal:
            controller.signal,
        };


        log(
          'fetch protected:',
          method,
          requestUrl
        );


        return NativeFetch(
          input,
          safeInit
        );
      };
  }


  /*
   * ============================================================
   * 3. Patch uni.request
   *
   * 这里不负责多发。
   *
   * 这里只负责：
   *
   *     timeout → 24 hours
   *
   * Hedged Request 统一放到 ba0d 层，
   * 防止两层都多发导致 2 × 2 = 4 个请求。
   * ============================================================
   */

  function patchUniRequest(
    uniObject
  ) {
    if (
      !uniObject ||
      typeof uniObject.request !==
        'function'
    ) {
      return false;
    }


    const current =
      uniObject.request;


    if (
      current.__TYXKHELPER_TIMEOUT_PATCHED__
    ) {
      return true;
    }


    const original =
      current;


    function patchedUniRequest(
      options,
      ...rest
    ) {
      if (
        options &&
        typeof options === 'object' &&
        isTargetUrl(options.url)
      ) {
        const previousTimeout =
          options.timeout;


        const newOptions = {
          ...options,

          timeout:
            LONG_TIMEOUT_MS,
        };


        log(
          'uni.request timeout:',
          previousTimeout,
          '→',
          LONG_TIMEOUT_MS,
          normalizeMethod(
            newOptions.method
          ),
          newOptions.url
        );


        return Reflect.apply(
          original,
          this,
          [
            newOptions,
            ...rest,
          ]
        );
      }


      return Reflect.apply(
        original,
        this,
        [
          options,
          ...rest,
        ]
      );
    }


    Object.defineProperty(
      patchedUniRequest,
      '__TYXKHELPER_TIMEOUT_PATCHED__',
      {
        value: true,
      }
    );


    /*
     * 尽量保留原 function 上的自定义字段。
     */
    try {
      Object.assign(
        patchedUniRequest,
        original
      );
    } catch (_) {}


    try {
      uniObject.request =
        patchedUniRequest;


      if (
        uniObject.request !==
        patchedUniRequest
      ) {
        Object.defineProperty(
          uniObject,
          'request',
          {
            configurable: true,
            writable: true,
            value:
              patchedUniRequest,
          }
        );
      }


      log(
        'uni.request timeout patch installed'
      );


      return true;
    } catch (e) {
      error(
        'failed to patch uni.request:',
        e
      );

      return false;
    }
  }


  /*
   * document-start 时 uni 可能还不存在。
   *
   * 先尝试监听 window.uni 的首次赋值。
   */
  try {
    if (!window.uni) {
      const originalDescriptor =
        Object.getOwnPropertyDescriptor(
          window,
          'uni'
        );


      if (
        !originalDescriptor ||
        originalDescriptor.configurable
      ) {
        let storedValue =
          originalDescriptor?.value;


        Object.defineProperty(
          window,
          'uni',
          {
            configurable: true,

            enumerable:
              originalDescriptor
                ?.enumerable ??
              true,


            get() {
              let value;


              if (
                originalDescriptor?.get
              ) {
                value =
                  Reflect.apply(
                    originalDescriptor.get,
                    window,
                    []
                  );
              } else {
                value =
                  storedValue;
              }


              patchUniRequest(
                value
              );


              return value;
            },


            set(value) {
              if (
                originalDescriptor?.set
              ) {
                Reflect.apply(
                  originalDescriptor.set,
                  window,
                  [value]
                );
              } else {
                storedValue =
                  value;
              }


              patchUniRequest(
                value
              );
            },
          }
        );


        log(
          'waiting for window.uni'
        );
      }
    } else {
      patchUniRequest(
        window.uni
      );
    }
  } catch (e) {
    warn(
      'window.uni early hook failed:',
      e
    );
  }


  /*
   * ============================================================
   * 4. Hedged Request engine
   * ============================================================
   */

  function firstSuccessful(
    requestFactory
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        let settled = false;

        let launched = 0;

        let failures = 0;

        const errors = [];

        const timers = [];


        function cleanupTimers() {
          for (
            const timer of timers
          ) {
            clearTimeout(
              timer
            );
          }

          timers.length = 0;
        }


        function finishSuccess(
          value,
          index
        ) {
          if (settled) {
            return;
          }


          settled = true;

          cleanupTimers();


          log(
            `hedge #${index + 1} won`
          );


          resolve(value);
        }


        function finishFailureIfNeeded() {
          if (
            settled
          ) {
            return;
          }


          if (
            launched >=
              HEDGE_MAX_ATTEMPTS &&
            failures >=
              HEDGE_MAX_ATTEMPTS
          ) {
            settled = true;

            cleanupTimers();


            reject(
              errors[
                errors.length - 1
              ]
            );
          }
        }


        function launch(index) {
          if (
            settled ||
            index >=
              HEDGE_MAX_ATTEMPTS
          ) {
            return;
          }


          launched++;


          log(
            `hedge attempt ${
              index + 1
            }/${HEDGE_MAX_ATTEMPTS}`
          );


          let promise;


          try {
            promise =
              Promise.resolve(
                requestFactory(
                  index
                )
              );
          } catch (e) {
            promise =
              Promise.reject(e);
          }


          promise.then(
            result => {
              finishSuccess(
                result,
                index
              );
            },

            e => {
              failures++;

              errors.push(e);


              warn(
                `hedge #${
                  index + 1
                } failed`,
                e
              );


              /*
               * 如果第一路很快失败，
               * 不必继续等待完整 1500ms。
               *
               * 立即启动下一路。
               */
              if (
                !settled &&
                launched <
                  HEDGE_MAX_ATTEMPTS
              ) {
                launch(
                  launched
                );
              }


              finishFailureIfNeeded();
            }
          );
        }


        /*
         * 第一条请求立即发送。
         */
        launch(0);


        /*
         * 后续 hedge 延迟发送。
         */
        for (
          let index = 1;
          index <
            HEDGE_MAX_ATTEMPTS;
          index++
        ) {
          const timer =
            setTimeout(
              () => {
                if (
                  settled
                ) {
                  return;
                }


                /*
                 * 如果这一 attempt
                 * 之前因为上一请求快速失败
                 * 已经启动过，就不要重复启动。
                 */
                if (
                  launched <= index
                ) {
                  launch(
                    index
                  );
                }
              },

              HEDGE_DELAY_MS *
                index
            );


          timers.push(timer);
        }
      }
    );
  }


  /*
   * ============================================================
   * 5. Capture Webpack require()
   *
   * 当前站是 Webpack JSONP 风格：
   *
   * window.webpackJsonp
   *
   * ba0d 是网站统一 request module。
   * ============================================================
   */

  let capturedWebpackRequire =
    null;


  function tryCaptureWebpackRequire() {
    if (
      capturedWebpackRequire
    ) {
      return true;
    }


    if (
      window.__TYXKHELPER_WEBPACK_REQUIRE__
    ) {
      capturedWebpackRequire =
        window.__TYXKHELPER_WEBPACK_REQUIRE__;

      return true;
    }


    const jsonp =
      window.webpackJsonp;


    if (
      !jsonp ||
      typeof jsonp.push !==
        'function'
    ) {
      return false;
    }


    try {
      const suffix =
        Math.random()
          .toString(36)
          .slice(2);


      const moduleId =
        `__tyxkhelper_capture_${suffix}`;


      const chunkId =
        `__tyxkhelper_chunk_${suffix}`;


      const modules = {};


      modules[moduleId] =
        function (
          module,
          exports,
          __webpack_require__
        ) {
          capturedWebpackRequire =
            __webpack_require__;


          window.__TYXKHELPER_WEBPACK_REQUIRE__ =
            __webpack_require__;
        };


      /*
       * Webpack 4 JSONP runtime。
       */
      jsonp.push([
        [chunkId],

        modules,

        [
          [moduleId]
        ],
      ]);


      if (
        capturedWebpackRequire
      ) {
        log(
          'Webpack require captured'
        );

        return true;
      }
    } catch (e) {
      /*
       * runtime 尚未初始化时失败是正常的，
       * 后面继续 polling。
       */
    }


    return false;
  }


  /*
   * ============================================================
   * 6. Patch ba0d request wrapper
   *
   * GET / HEAD:
   *     hedged requests
   *
   * POST / PUT / PATCH / DELETE:
   *     only once
   * ============================================================
   */

  function patchBa0d() {
    if (
      window.__TYXKHELPER_BA0D_PATCHED__
    ) {
      return true;
    }


    if (
      !tryCaptureWebpackRequire()
    ) {
      return false;
    }


    const req =
      capturedWebpackRequire;


    if (
      typeof req !== 'function'
    ) {
      return false;
    }


    let requestModule;


    try {
      requestModule =
        req('ba0d');
    } catch (_) {
      /*
       * 模块还没有注册。
       */
      return false;
    }


    if (
      !requestModule
    ) {
      return false;
    }


    const originalRequest =
      requestModule.default;


    if (
      typeof originalRequest !==
        'function'
    ) {
      return false;
    }


    if (
      originalRequest
        .__TYXKHELPER_HEDGE_PATCHED__
    ) {
      window.__TYXKHELPER_BA0D_PATCHED__ =
        true;

      return true;
    }


    function patchedRequest(
      config = {},
      ...rest
    ) {
      const method =
        normalizeMethod(
          config.method
        );


      let target = false;


      try {
        target =
          isTargetUrl(
            config.url
          );
      } catch (_) {}


      /*
       * 非目标域名：
       *
       * 完全保持原行为。
       */
      if (!target) {
        return Reflect.apply(
          originalRequest,
          this,
          [
            config,
            ...rest,
          ]
        );
      }


      /*
       * 所有目标请求：
       *
       * 尽量扩大 wrapper timeout。
       */
      const baseConfig = {
        ...config,

        timeout:
          LONG_TIMEOUT_MS,
      };


      /*
       * ========================================================
       * 写请求绝不多发
       * ========================================================
       */

      if (
        !isSafeToHedge(
          method
        )
      ) {
        log(
          'single request:',
          method,
          config.url
        );


        return Reflect.apply(
          originalRequest,
          this,
          [
            baseConfig,
            ...rest,
          ]
        );
      }


      /*
       * ========================================================
       * GET / HEAD:
       *
       * Hedged Request
       * ========================================================
       */

      log(
        'hedged request:',
        method,
        config.url,
        `max=${HEDGE_MAX_ATTEMPTS}`,
        `delay=${HEDGE_DELAY_MS}ms`
      );


      const self = this;


      return firstSuccessful(
        attemptIndex => {
          const attemptConfig = {
            ...baseConfig,
          };


          log(
            `sending hedge #${
              attemptIndex + 1
            }:`,
            method,
            attemptConfig.url
          );


          /*
           * 每一个 attempt
           * 都重新走网站自己的 request wrapper。
           *
           * 因此继续保留：
           *
           * headers
           * token
           * params
           * interceptors
           * response handling
           *
           * 等原有逻辑。
           */
          return Reflect.apply(
            originalRequest,
            self,
            [
              attemptConfig,
              ...rest,
            ]
          );
        }
      );
    }


    Object.defineProperty(
      patchedRequest,
      '__TYXKHELPER_HEDGE_PATCHED__',
      {
        value: true,
      }
    );


    /*
     * 尽可能复制函数上的属性。
     */
    try {
      Object.assign(
        patchedRequest,
        originalRequest
      );
    } catch (_) {}


    try {
      requestModule.default =
        patchedRequest;


      if (
        requestModule.default !==
        patchedRequest
      ) {
        Object.defineProperty(
          requestModule,
          'default',
          {
            configurable: true,
            writable: true,
            value:
              patchedRequest,
          }
        );
      }


      window.__TYXKHELPER_BA0D_PATCHED__ =
        true;


      console.log(
        '%c[TYXKhelper] ba0d KeepAlive + Hedge installed',
        'font-weight:bold'
      );


      return true;
    } catch (e) {
      error(
        'failed to patch ba0d:',
        e
      );

      return false;
    }
  }


  /*
   * ============================================================
   * 7. Installation loop
   *
   * 因为：
   *
   * - uni
   * - Webpack runtime
   * - ba0d
   *
   * 都可能在 document-start 以后才创建。
   * ============================================================
   */

  const installStartedAt =
    Date.now();


  const installTimer =
    setInterval(
      () => {
        /*
         * uni.request
         */
        try {
          if (
            window.uni
          ) {
            patchUniRequest(
              window.uni
            );
          }
        } catch (_) {}


        /*
         * Webpack ba0d
         */
        try {
          patchBa0d();
        } catch (e) {
          warn(
            'ba0d patch attempt failed:',
            e
          );
        }


        if (
          Date.now() -
            installStartedAt >
          PATCH_WINDOW_MS
        ) {
          clearInterval(
            installTimer
          );


          log(
            'initial patch polling finished'
          );
        }
      },

      PATCH_INTERVAL_MS
    );


  /*
   * ============================================================
   * Startup log
   * ============================================================
   */

  console.log(
    '%c[TYXKhelper] Request KeepAlive + Hedge V3 installed at document-start',
    'font-weight:bold'
  );


  log(
    'target:',
    TARGET_HOST
  );


  log(
    'timeout:',
    LONG_TIMEOUT_MS,
    'ms'
  );


  log(
    'GET/HEAD hedge:',
    `${HEDGE_MAX_ATTEMPTS} attempts`,
    `${HEDGE_DELAY_MS}ms delay`
  );


  log(
    'POST/PUT/PATCH/DELETE:',
    'single request only'
  );
})();
