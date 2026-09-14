import { ApiSettings, LoginResponse } from './types';
import { enqueueMutation, getQueue, setQueue } from './storage';

function uuidLike() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export class FieldProofApi {
  settings: ApiSettings;
  onUnauthorized?: () => void | Promise<void>;
  constructor(settings: ApiSettings, onUnauthorized?: () => void | Promise<void>) {
    this.settings = settings;
    this.onUnauthorized = onUnauthorized;
  }

  url(path: string) {
    const base = this.settings.apiUrl.replace(/\/$/, '');
    return `${base}${path}`;
  }

  async request(path: string, init: RequestInit = {}, authenticated = true) {
    const headers: Record<string,string> = {
      ...(authenticated && this.settings.orgId ? {'X-Org-Id': this.settings.orgId} : {}),
      ...(authenticated && this.settings.accessToken ? {'Authorization': `Bearer ${this.settings.accessToken}`} : {}),
      ...(init.headers as Record<string,string> || {})
    };
    if (init.body && !(init.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const res = await fetch(this.url(path), { ...init, headers });
    if (!res.ok) {
      if (authenticated && res.status === 401 && this.onUnauthorized) {
        try { await this.onUnauthorized(); } catch {}
      }
      let detail = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); detail = j.detail || JSON.stringify(j); } catch {}
      const err:any = new Error(detail); err.status = res.status; throw err;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    return this.request('/v1/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password}) }, false);
  }
  me() { return this.get('/v1/auth/me'); }
  get(path: string) { return this.request(path); }
  post(path: string, body: any) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }); }

  async postOrQueue(path: string, body: any) {
    try { return { queued: false, data: await this.post(path, body) }; }
    catch (e: any) {
      if (e?.status === 401 || e?.status === 403) throw e;
      if (/Failed to fetch|Network request failed|Load failed/i.test(String(e?.message || e))) {
        await enqueueMutation({ id: uuidLike(), method: 'POST', path, body, createdAt: new Date().toISOString() });
        return { queued: true, data: null };
      }
      throw e;
    }
  }

  async flushQueue() {
    const q = await getQueue();
    const remaining = [];
    let synced = 0;
    for (const item of q) {
      try { await this.post(item.path, item.body); synced++; }
      catch (e:any) {
        if (e?.status === 401 || e?.status === 403) throw e;
        remaining.push(item);
      }
    }
    await setQueue(remaining);
    return { synced, remaining: remaining.length };
  }

  projects() { return this.get('/v1/projects'); }
  dashboard(projectId = this.settings.projectId) { return this.get(`/v1/projects/${projectId}/dashboard`); }
  assets(projectId = this.settings.projectId) { return this.get(`/v1/projects/${projectId}/assets`); }
  asset(id: string) { return this.get(`/v1/assets/${id}`); }
  timeline(id: string) { return this.get(`/v1/assets/${id}/timeline`); }
  measurements(id: string, key?: string) { return this.get(`/v1/assets/${id}/measurements${key ? `?parameter_key=${encodeURIComponent(key)}` : ''}`); }
  comparison(id: string, baselineCode='B1') { return this.get(`/v1/assets/${id}/comparison?baseline_code=${encodeURIComponent(baselineCode)}`); }
  templates(type?: string) { return this.get(`/v1/templates${type ? `?workflow_type=${encodeURIComponent(type)}` : ''}`); }
  workflows(projectId = this.settings.projectId) { return this.get(`/v1/projects/${projectId}/workflows`); }
  requirements(projectId = this.settings.projectId, assetId?: string) { return this.get(`/v1/projects/${projectId}/evidence-requirements${assetId ? `?asset_id=${assetId}` : ''}`); }
  packageVersions(projectId = this.settings.projectId) { return this.get(`/v1/projects/${projectId}/package-versions`); }
  manifest(projectId = this.settings.projectId) { return this.get(`/v1/projects/${projectId}/package-manifest`); }

  createWorkflow(body: any) { return this.postOrQueue('/v1/workflow-runs', body); }
  addResult(workflowId: string, body: any) { return this.postOrQueue(`/v1/workflow-runs/${workflowId}/results`, body); }
  completeWorkflow(workflowId: string, body: any) { return this.postOrQueue(`/v1/workflow-runs/${workflowId}/complete`, body); }
  addMeasurement(assetId: string, body: any) { return this.postOrQueue(`/v1/assets/${assetId}/measurements`, body); }
  createDeficiency(body: any) { return this.postOrQueue('/v1/deficiencies', body); }
  createServiceVisit(body: any) { return this.postOrQueue('/v1/service-visits', body); }
  closeServiceVisit(id: string, body: any) { return this.postOrQueue(`/v1/service-visits/${id}/close`, body); }
  generatePackage(projectId: string, body: any) { return this.post(`/v1/projects/${projectId}/package-versions`, body); }

  async uploadEvidence(assetId: string, fields: Record<string, any>, picked: any) {
    const form = new FormData();
    Object.entries(fields).forEach(([k,v]) => { if (v !== undefined && v !== null && v !== '') form.append(k, String(v)); });
    if (picked.file) form.append('file', picked.file, picked.fileName || 'evidence.jpg');
    else form.append('file', { uri: picked.uri, name: picked.fileName || 'evidence.jpg', type: picked.mimeType || 'image/jpeg' } as any);
    return this.request(`/v1/assets/${assetId}/evidence`, { method: 'POST', body: form });
  }
}
