// this is temporary, eventually I'll build an actual fallback page
const HOME="https://www.rtccoalition.org/"
const NO_DOMAIN=HOME

class AttributeRewriter {
  constructor(attributeName, OLD_URL, NEW_URL) {
    this.attributeName = attributeName
    this.OLD_URL = OLD_URL
    this.NEW_URL = NEW_URL
  }
  element(element) {
    const attribute = element.getAttribute(this.attributeName)
    if (attribute) {
      element.setAttribute(
        this.attributeName,
        attribute.replace(this.OLD_URL, this.NEW_URL),
      )
    }
  }
}

var config = {
  basic: {
    upstream: NO_DOMAIN,
    mobileRedirect: NO_DOMAIN,
  },

  firewall: {
    blockedIPAddress: [],
    blockedRegion: [],
    // blockedRegion: ['CN', 'KP', 'SY', 'PK', 'CU'],
    scrapeShield: true,
  },

  // for region-specific routing, we probably won't support this yet
  routes: {
    
  },

  optimization: {
    cacheEverything: false,
    cacheTtl: 5,
    mirage: true,
    polish: 'off',
    minify: {
      javascript: true,
      css: true,
      html: true,
    },
  },
};

async function isMobile(userAgent) {
  const agents = ['Android', 'iPhone', 'SymbianOS', 'Windows Phone', 'iPad', 'iPod'];
  return agents.any((agent) => userAgent.indexOf(agent) > 0);
}

async function fetchAndApply(request) {
  const tmpUrl = new URL(request.url)
  const host = tmpUrl.hostname
  const protocol = tmpUrl.protocol+"//"
  
  if (host.split(".").length==2) {
    return Response.redirect(HOME, 301)
  }
  config.basic.upstream = await dest.get(host) || NO_DOMAIN
  config.basic.mobileRedirect = config.basic.upstream
  
  const rewriter = new HTMLRewriter()
  .on("a", new AttributeRewriter("href", protocol+config.basic.upstream, host))
  .on("img", new AttributeRewriter("src", protocol+config.basic.upstream, host))
  
  const region = request.headers.get('cf-ipcountry') || '';
  const ipAddress = request.headers.get('cf-connecting-ip') || '';
  const userAgent = request.headers.get('user-agent') || '';

  if (region !== '' && config.firewall.blockedRegion.includes(region.toUpperCase())) {
    return new Response(
      'Access denied: booster.js is not available in your region.',
      {
        status: 403,
      },
    );
  } if (ipAddress !== '' && config.firewall.blockedIPAddress.includes(ipAddress)) {
    return new Response(
      'Access denied: Your IP address is blocked by booster.js.',
      {
        status: 403,
      },
    );
  }

  const requestURL = new URL(request.url);
  let upstreamURL = null;

  if (userAgent && isMobile(userAgent) === true) {
    upstreamURL = new URL(config.basic.mobileRedirect);
  } else if (region && region.toUpperCase() in config.routes) {
    upstreamURL = new URL(config.routes[region.toUpperCase()]);
  } else {
    upstreamURL = new URL(config.basic.upstream);
  }

  requestURL.protocol = upstreamURL.protocol;
  requestURL.host = upstreamURL.host;
  requestURL.pathname = upstreamURL.pathname + requestURL.pathname;

  let newRequest;
  if (request.method === 'GET' || request.method === 'HEAD') {
    newRequest = new Request(requestURL, {
      cf: {
        cacheEverything: config.optimization.cacheEverything,
        cacheTtl: config.optimization.cacheTtl,
        mirage: config.optimization.mirage,
        polish: config.optimization.polish,
        minify: config.optimization.minify,
        scrapeShield: config.firewall.scrapeShield,
      },
      method: request.method,
      headers: request.headers,
    });
  } else {
    const requestBody = await request.text();
    newRequest = new Request(requestURL, {
      cf: {
        cacheEverything: config.optimization.cacheEverything,
        cacheTtl: config.optimization.cacheTtl,
        mirage: config.optimization.mirage,
        polish: config.optimization.polish,
        minify: config.optimization.minify,
        scrapeShield: config.firewall.scrapeShield,
      },
      method: request.method,
      headers: request.headers,
      body: requestBody,
    });
  }

  const fetchedResponse = await fetch(newRequest);

  const modifiedResponseHeaders = new Headers(fetchedResponse.headers);
  if (modifiedResponseHeaders.has('x-pjax-url')) {
    const pjaxURL = new URL(modifiedResponseHeaders.get('x-pjax-url'));
    pjaxURL.protocol = requestURL.protocol;
    pjaxURL.host = requestURL.host;
    pjaxURL.pathname = pjaxURL.path.replace(requestURL.pathname, '/');

    modifiedResponseHeaders.set(
      'x-pjax-url',
      pjaxURL.href,
    );
    
    // from https://gitee.com/xAsiimov/Workers-Proxy/blob/master/src/index.js
    modifiedResponseHeaders.set('access-control-allow-origin', '*');
    modifiedResponseHeaders.set('access-control-allow-credentials', true);
    modifiedResponseHeaders.delete('content-security-policy');
    modifiedResponseHeaders.delete('content-security-policy-report-only');
    modifiedResponseHeaders.delete('clear-site-data');
    
    
  }

  return new Response(
    fetchedResponse.body,
    {
      headers: modifiedResponseHeaders,
      status: fetchedResponse.status,
      statusText: fetchedResponse.statusText,
    },
  );
}

// eslint-disable-next-line no-restricted-globals
addEventListener('fetch', (event) => {
  event.respondWith(fetchAndApply(event.request));
});
