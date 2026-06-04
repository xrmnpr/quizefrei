const API = (() => {
  const BASE = '/api';

  function getToken() { return localStorage.getItem('qe_token'); }
  function setToken(t) { localStorage.setItem('qe_token', t); }
  function clearToken() { localStorage.removeItem('qe_token'); localStorage.removeItem('qe_user'); }

  async function request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const token = getToken();
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    return data;
  }

  return {
    getToken, setToken, clearToken,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    delete: (p) => request('DELETE', p),

    // Auth
    login: (email, password) => request('POST', '/auth/login', { email, password }),
    register: (data) => request('POST', '/auth/register', data),
    me: () => request('GET', '/auth/me'),

    // Lists
    getLists: () => request('GET', '/lists'),
    getMyLists: () => request('GET', '/lists/mine'),
    getList: (id) => request('GET', `/lists/${id}`),
    createList: (data) => request('POST', '/lists', data),
    updateList: (id, data) => request('PUT', `/lists/${id}`, data),
    deleteList: (id) => request('DELETE', `/lists/${id}`),
    addQuestion: (listId, data) => request('POST', `/lists/${listId}/questions`, data),
    updateQuestion: (listId, qId, data) => request('PUT', `/lists/${listId}/questions/${qId}`, data),
    deleteQuestion: (listId, qId) => request('DELETE', `/lists/${listId}/questions/${qId}`),
    shareList: (id, email) => request('POST', `/lists/${id}/share`, { email }),
    getShares: (id) => request('GET', `/lists/${id}/shares`),
    removeShare: (id, userId) => request('DELETE', `/lists/${id}/share/${userId}`),

    // Sessions
    startSession: (data) => request('POST', '/sessions/start', data),
    submitSession: (id, responses) => request('POST', `/sessions/${id}/submit`, { responses }),
    getMySessions: () => request('GET', '/sessions/mine'),
    getSession: (id) => request('GET', `/sessions/${id}`),
    getClassResults: (classId) => request('GET', `/sessions/class/${classId}/results`),

    // Classes
    getClasses: () => request('GET', '/classes'),
    getClass: (id) => request('GET', `/classes/${id}`),
    createClass: (data) => request('POST', '/classes', data),
    updateClass: (id, data) => request('PUT', `/classes/${id}`, data),
    deleteClass: (id) => request('DELETE', `/classes/${id}`),
    joinClass: (code) => request('POST', '/classes/join', { invite_code: code }),
    removeMember: (classId, studentId) => request('DELETE', `/classes/${classId}/members/${studentId}`),
    addListToClass: (classId, listId) => request('POST', `/classes/${classId}/lists`, { list_id: listId }),
    removeListFromClass: (classId, listId) => request('DELETE', `/classes/${classId}/lists/${listId}`),
    regenerateCode: (classId) => request('POST', `/classes/${classId}/regenerate-code`),

    // Admin
    adminStats: () => request('GET', '/admin/stats'),
    adminUsers: () => request('GET', '/admin/users'),
    adminUpdateRole: (id, role) => request('PUT', `/admin/users/${id}/role`, { role }),
    adminDeleteUser: (id) => request('DELETE', `/admin/users/${id}`)
  };
})();
