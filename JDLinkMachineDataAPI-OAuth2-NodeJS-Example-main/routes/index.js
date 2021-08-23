const axios = require('axios').default;
const express = require('express');
const qs = require('qs');
const router = express.Router();

const port = process.env.PORT || '9090';
const serverUrl = `http://localhost:${port}`;

let settings = {
  apiUrl: 'https://sandboxaemp.deere.com/Fleet',
  callbackUrl: `${serverUrl}/callback`,
  clientId: '',
  clientSecret: '',
  orgConnectionCompletedUrl: serverUrl,
  scopes: 'offline_access eq1',
  state: 'test',
  wellKnown: 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/.well-known/oauth-authorization-server'
};
let metaData = {};

const populateSettings = (reqBody) => {
  settings = {
    ...settings,
    clientId: reqBody.clientId,
    clientSecret: reqBody.clientSecret,
    wellKnown: reqBody.wellKnown,
    callbackUrl: reqBody.callbackUrl,
    scopes: reqBody.scopes,
    state: reqBody.state
  };
};

const updateTokenInfo = (token) => {
  settings = {
    ...settings,
    idToken: token.id_token,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    exp: token.expires_in
  };
}

const needsOrganizationAccess = async () => {
  const response = (await axios.get(`${settings.apiUrl}/1`, {
    headers: {
      'Authorization': `Bearer ${settings.accessToken}`,
      'Accept': 'application/xml'
    }
  })).data;

  const DOMParser = require('xmldom').DOMParser;
  const xmlDoc = new DOMParser().parseFromString(response, "text/xml");
  const x = xmlDoc.getElementsByTagName('rel');
  const y = xmlDoc.getElementsByTagName('href');
  let rel;
  let href;
  for (let i = 0; i < x.length; i++) {
    rel = x[i].childNodes[0].nodeValue;
    for (let i = 0; i < x.length; i++){
      href = y[i].childNodes[0].nodeValue;
    }
  }
  if (rel.startsWith("connections")) {
    const param = new URLSearchParams({
      redirect_uri: settings.orgConnectionCompletedUrl
    });
    return `${href}?${param.toString()}`;
  }
  return null;
};

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', settings);
});

/* Initialize OIDC login */
router.post('/', async function ({ body }, res, next) {
  populateSettings(body);

  metaData = (await axios.get(body.wellKnown)).data;
  const params = new URLSearchParams({
    client_id: body.clientId,
    response_type: 'code',
    scope: body.scopes,
    redirect_uri: body.callbackUrl,
    state: body.state
  });

  res.redirect(`${metaData.authorization_endpoint}?${params.toString()}`)
});

/* OIDC callback */
router.get('/callback', async function ({ query }, res, next) {
  if (query.error) {
    const description = query.error_description;
    return res.render('error', {
      error: description
    });
  }

  try {
    const code = query.code;
    const basicAuthHeader = Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64');

    const token = (await axios.post(metaData.token_endpoint, qs.stringify({
      grant_type: 'authorization_code',
      redirect_uri: settings.callbackUrl,
      code,
      scope: settings.scopes
    }), {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${basicAuthHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })).data;

    updateTokenInfo(token);

    const organizationAccessUrl = await needsOrganizationAccess();

    if (organizationAccessUrl) {
      res.redirect(organizationAccessUrl);
    } else {
      res.render('index', settings);
    }
  } catch (e) {
    return res.render('error', {
      error: e
    });
  }
});

router.get('/refresh-access-token', async function (req, res, next) {
  try {
    const basicAuthHeader = Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64');

    const token = (await axios.post(metaData.token_endpoint, qs.stringify({
      grant_type: 'refresh_token',
      redirect_uri: settings.callbackUrl,
      refresh_token: settings.refreshToken,
      scope: settings.scopes
    }), {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${basicAuthHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })).data;

    updateTokenInfo(token);
    res.render('index', settings);
  } catch (e) {
    return res.render('error', {
      error: e
    });
  }
});

router.post('/call-api', async function ({ body }, res, next) {
  try {
    const response = (await axios.get(body.url, {
      headers: {
        'Authorization': `Bearer ${settings.accessToken}`,
        'Accept': 'application/xml'
      }
    })).data;
    const XmlBeautify = require('xml-beautify');
    const { DOMParser } = require('xmldom');
    const beautifiedXmlText = new XmlBeautify({ parser: DOMParser }).beautify(response);
    res.render('index', {
      ...settings,
      apiResponse: beautifiedXmlText
    });
  } catch (e) {
    return res.render('error', {
      error: e
    });
  }
});

module.exports = router;
