// tests.thesciclub.com while thesciclub.com's DNS is at Spaceship (the owner,
// 2026-11-20). A Worker can take a custom domain only in a zone on Cloudflare;
// a Pages project can take one by CNAME from anywhere. So this Pages project
// holds the name and hands every request to the Worker thesciclub-tests,
// which the Site workflow deploys on each push to tests. Pages is deployed
// once, by hand (its free plan counts deploys; Workers do not):
//
//   wrangler pages deploy cloudflare/tests-domain --project-name thesciclub-tests --branch main

const WORKER = 'thesciclub-tests.sciclub.workers.dev';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const shown = url.host;
    url.host = WORKER;
    const upstream = await fetch(new Request(url, request), { redirect: 'manual' });
    const response = new Response(upstream.body, upstream);
    // A redirect names the Worker's address; send the visitor back to this one.
    const location = response.headers.get('Location');
    if (location?.includes(WORKER)) {
      response.headers.set('Location', location.replaceAll(WORKER, shown));
    }
    return response;
  },
};
