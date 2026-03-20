import http from 'http';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5001';

class ApiClient {
  constructor() {
    this.cookie = '';
  }

  async request(method, path, body = null) {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (this.cookie) {
      options.headers['Cookie'] = this.cookie;
    }

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(url, options);
      
      // Save cookies
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        // Just grab the connect.sid session cookie
        const match = setCookie.match(/(connect\.sid=[^;]+)/);
        if (match) this.cookie = match[1];
      }

      const text = await res.text();
      let data = text;
      try { data = JSON.parse(text); } catch(e) {}
      
      return { status: res.status, data };
    } catch(e) {
      console.error(`Request to ${path} failed:`, e);
      return { status: 500, data: { error: e.message } };
    }
  }
}

async function runTests() {
  console.log(`Starting Endpoint Verification Tests on ${BASE_URL}...`);
  
  const clientA = new ApiClient();
  const clientB = new ApiClient();
  let errors = 0;

  function assertStatus(result, expected, ctx) {
    if (result.status !== expected) {
      console.error(`❌ [FAILED] ${ctx} | Expected ${expected}, got ${result.status} | response:`, result.data);
      errors++;
    } else {
      console.log(`✅ [PASS] ${ctx}`);
    }
  }

  const timestamp = Date.now();
  
  // 1. Signup Business A
  const signupA = await clientA.request('POST', '/api/auth/signup', {
    businessName: `Test A ${timestamp}`,
    email: `a${timestamp}@test.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  });
  assertStatus(signupA, 201, 'Signup Business A');
  if (signupA.status !== 201) return console.log("Aborting");

  const loginA = await clientA.request('POST', '/api/auth/login', {
    email: `a${timestamp}@test.com`,
    password: 'Password123!'
  });
  assertStatus(loginA, 200, 'Login Business A');

  // 2. Signup & Login Business B
  const signupB = await clientB.request('POST', '/api/auth/signup', {
    businessName: `Test B ${timestamp}`,
    email: `b${timestamp}@test.com`,
    password: 'Password123!',
    confirmPassword: 'Password123!'
  });
  assertStatus(signupB, 201, 'Signup Business B');
  const loginB = await clientB.request('POST', '/api/auth/login', {
    email: `b${timestamp}@test.com`,
    password: 'Password123!'
  });
  assertStatus(loginB, 200, 'Login Business B');

  // Verify GET /api/business
  const bizA = await clientA.request('GET', '/api/business');
  assertStatus(bizA, 200, 'GET /api/business (Business A)');
  
  const bizB = await clientB.request('GET', '/api/business');
  assertStatus(bizB, 200, 'GET /api/business (Business B)');
  
  if (bizA.data.id === bizB.data.id) {
    console.error("❌ [FAILED] Business A and B got the same business ID! Global leak active.");
    errors++;
  } else {
    console.log("✅ [PASS] Business endpoint returns isolated businesses.");
  }

  // 3. Create Store A
  const storeA = await clientA.request('POST', '/api/stores', {
    name: 'Store A',
    code: `STA${timestamp}`,
  });
  assertStatus(storeA, 201, 'Create Store A');
  const storeIdA = storeA.data?.id;

  // Create Store B
  const storeB = await clientB.request('POST', '/api/stores', {
    name: 'Store B',
    code: `STB${timestamp}`,
  });
  assertStatus(storeB, 201, 'Create Store B');
  const storeIdB = storeB.data?.id;

  if (errors > 0 || !storeIdA || !storeIdB) {
     console.log("Aborting core tests due to preconditions failing.");
     return { errors };
  }

  // 4. Test Cross-Tenant Access to Store
  const getStoreACross = await clientB.request('GET', `/api/stores/${storeIdA}`);
  assertStatus(getStoreACross, 403, 'Cross-Tenant GET /api/stores/:id expects 403');

  const patchStoreACross = await clientB.request('PATCH', `/api/stores/${storeIdA}`, { name: 'Hacked' });
  assertStatus(patchStoreACross, 403, 'Cross-Tenant PATCH /api/stores/:id expects 403');

  // 5. Test dependent endpoints (Customers, Staff, Inventory)
  const custA = await clientA.request('POST', '/api/customers', {
    storeId: storeIdA,
    name: 'Customer A',
    mobileNumber: '+2348000000000',
    address: '123 Test'
  });
  assertStatus(custA, 201, 'Create Customer for Store A');
  
  const staffA = await clientA.request('POST', '/api/staff', {
    storeId: storeIdA,
    name: 'Staff A',
    email: `staffa${timestamp}@a.com`,
    mobileNumber: '+2348000000000',
    role: 'staff'
  });
  assertStatus(staffA, 201, 'Create Staff for Store A');
  
  const invA = await clientA.request('POST', '/api/inventory', {
    storeId: storeIdA,
    name: 'Product A',
    type: 'product',
  });
  assertStatus(invA, 201, 'Create Inventory for Store A');

  // 6. Test Cross-Tenant Access on Dependent Endpoints
  const crossCustCreate = await clientB.request('POST', '/api/customers', {
    storeId: storeIdA,
    name: 'Hacked Customer',
    mobileNumber: '+1234',
    address: 'Hacked'
  });
  assertStatus(crossCustCreate, 403, 'Cross-Tenant POST /api/customers expects 403');

  const crossCustList = await clientB.request('GET', `/api/customers?storeId=${storeIdA}`);
  assertStatus(crossCustList, 403, 'Cross-Tenant GET /api/customers expects 403');

  const crossInvList = await clientB.request('GET', `/api/inventory?storeId=${storeIdA}`);
  assertStatus(crossInvList, 403, 'Cross-Tenant GET /api/inventory expects 403');

  const crossStats = await clientB.request('GET', `/api/dashboard/stats?storeId=${storeIdA}`);
  assertStatus(crossStats, 403, 'Cross-Tenant GET /api/dashboard/stats expects 403');

  console.log(`\\nTest Suite Completed. Errors: ${errors}`);
  if (errors === 0) {
    console.log("🎉 ALL TESTS PASSED! Multi-tenant isolation is solidly verified.");
  }
}

runTests();
