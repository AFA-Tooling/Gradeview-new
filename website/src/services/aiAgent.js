// src/services/aiAgent.js
import {
  buildCourseScopedAIPath,
  createLiveCourseSource,
  normalizeAIAnalyticsCourseId,
} from '../utils/aiAnalytics';

/**
 * AI Agent Service - Universal Version
 * Agent capabilities:
 * 1. Understand database schema
 * 2. Dynamically generate SQL from natural language
 * 3. Execute queries and return results
 * 4. Use AI to explain results
 */

export class AIQueryRequestError extends Error {
  constructor(message, {
    status = 0,
    code = 'QUERY_FAILED',
    reason = '',
    recovery = '',
  } = {}) {
    super(message);
    this.name = 'AIQueryRequestError';
    this.status = status;
    this.code = code;
    this.reason = reason || message;
    this.recovery = recovery;
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

function createScopedRequestSignal(upstreamSignal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) {
    controller.abort();
  } else {
    upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    },
  };
}

async function parseResponsePayload(response) {
  return response.json().catch(() => null);
}

function createResponseError(response, payload, fallbackMessage) {
  const reason = payload?.reason || payload?.message || payload?.error || fallbackMessage;
  return new AIQueryRequestError(reason, {
    status: response?.status || 0,
    code: payload?.code || 'QUERY_FAILED',
    reason,
    recovery: payload?.recovery || '',
  });
}

export class AIAgent {
  constructor() {
    this.apiKey = ''; // API key (read from environment variables)
    this.conversationHistory = [];
    this.initialized = false;
    this.databaseSchema = null;
  }

  /**
   * Initialize AI Agent
   * @param {string} apiKey - AI service API key (optional, environment variable takes priority)
   */
  async initialize({ apiKey = '', courseId = '', signal } = {}) {
    this.apiKey = apiKey || process.env.REACT_APP_OPENAI_API_KEY || '';
    this.initialized = true;
    
    // Fetch database schema
    try {
      await this.fetchDatabaseSchema(courseId, signal);
      console.log('AI Agent initialized with database schema');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('Failed to fetch database schema:', error);
      console.log('AI Agent initialized in basic mode');
    }
  }

  /**
   * Fetch Database Schema Information
   */
  async fetchDatabaseSchema(courseId, signal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const token = localStorage.getItem('token');
    if (!token) {
      console.warn('No auth token, skipping schema fetch');
      return;
    }

    const normalizedCourseId = normalizeAIAnalyticsCourseId(courseId);
    if (!normalizedCourseId) return;

    const request = createScopedRequestSignal(signal, timeoutMs);
    try {
      const response = await fetch(buildCourseScopedAIPath('/api/v2/admin/ai-query/schema', normalizedCourseId), {
        method: 'GET',
        headers: {
          'Authorization': token
        },
        signal: request.signal,
      });

      const data = await parseResponsePayload(response);
      if (!response.ok) {
        throw createResponseError(
          response,
          data,
          `Schema request failed with status ${response.status}.`,
        );
      }

      this.databaseSchema = data?.schema || null;
      console.log('Database schema loaded:', this.databaseSchema);
      return this.databaseSchema;
    } catch (error) {
      if (error?.name === 'AbortError' && request.didTimeOut()) {
        throw new AIQueryRequestError('The schema request timed out.', {
          code: 'REQUEST_TIMEOUT',
          reason: 'The selected course schema did not load before the request timed out.',
          recovery: 'Retry after checking the GradeView service connection.',
        });
      }
      throw error;
    } finally {
      request.cleanup();
    }
  }

  /**
   * Process Query - Main Entry Point
   * @param {string} query - User's natural language query
   * @returns {Promise<object>} - Query results
   */
  async processQuery(query, { courseId, signal } = {}) {
    console.log(`[AI Agent] Processing query: "${query}"`);

    // Add to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: query,
      timestamp: new Date().toISOString()
    });

    // Call backend API (AI will dynamically generate SQL)
    const response = await this.queryBackend(query, { courseId, signal });
    console.log('[AI Agent] Query successful:', response);

    // Add to conversation history
    this.conversationHistory.push({
      role: 'assistant',
      content: response.answer,
      timestamp: new Date().toISOString(),
      data: response.data
    });

    return response;
  }

  /**
   * Call Backend API for Querying
   * Backend will use AI to generate SQL and execute
   * @param {string} query - User query
   * @returns {Promise<object>} - API response
   */
  async queryBackend(query, {
    courseId,
    signal,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = {}) {
    // Get authentication token from localStorage
    const token = localStorage.getItem('token');
    if (!token) {
      throw new AIQueryRequestError('Your session is no longer available.', {
        status: 401,
        code: 'SESSION_REQUIRED',
      });
    }

    const normalizedCourseId = normalizeAIAnalyticsCourseId(courseId);
    if (!normalizedCourseId) {
      throw new AIQueryRequestError('Select a course before running AI Analytics.', {
        status: 400,
        code: 'COURSE_REQUIRED',
      });
    }

    const request = createScopedRequestSignal(signal, timeoutMs);
    let response;
    let payload;
    try {
      response = await fetch(buildCourseScopedAIPath('/api/v2/admin/ai-query', normalizedCourseId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token
        },
        body: JSON.stringify({
          query: query,
          useAI: !!this.apiKey  // Use AI if API key exists, otherwise use rules
        }),
        signal: request.signal,
      });

      payload = await parseResponsePayload(response);
    } catch (error) {
      if (error?.name === 'AbortError' && request.didTimeOut()) {
        throw new AIQueryRequestError('The live course query timed out.', {
          code: 'REQUEST_TIMEOUT',
          reason: 'No live course result was produced before the request timed out.',
          recovery: 'Retry the query. If it continues to time out, contact the GradeView administrator.',
        });
      }
      if (error?.name === 'AbortError') throw error;
      throw new AIQueryRequestError('The live course query could not reach GradeView.', {
        code: 'NETWORK_ERROR',
        reason: 'No live course result was produced because the network request failed.',
        recovery: 'Check the connection and retry the query.',
      });
    } finally {
      request.cleanup();
    }

    if (!response.ok) {
      throw createResponseError(
        response,
        payload,
        `Request failed with status ${response.status}.`,
      );
    }
    if (payload?.type === 'error' || payload?.error) {
      throw createResponseError(
        { status: 500 },
        payload,
        payload?.answer || 'The query did not complete.',
      );
    }

    const responseCourseId = normalizeAIAnalyticsCourseId(payload?.source?.course_id);
    if (payload?.source?.type && payload.source.type !== 'live_course') {
      throw new AIQueryRequestError('The response was not identified as live course data.', {
        status: 409,
        code: 'SOURCE_MISMATCH',
      });
    }
    if (responseCourseId && responseCourseId !== normalizedCourseId) {
      throw new AIQueryRequestError('The response belongs to a different course.', {
        status: 409,
        code: 'SOURCE_MISMATCH',
      });
    }

    return {
      ...payload,
      source: payload?.source || createLiveCourseSource(normalizedCourseId),
    };
  }

  /**
   * Get Database Schema (for UI display)
   */
  getDatabaseSchema() {
    return this.databaseSchema;
  }

  /**
   * Get Conversation History
   */
  getConversationHistory() {
    return this.conversationHistory;
  }

  /**
   * Clear Conversation History
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Generate Query Suggestions
   */
  getSuggestions() {
    return [
      'Find students with the highest grade fluctuation',
      'Which assignments are the hardest?',
      'Show all students\' average scores',
      'Find assignments with latest submission times',
      'Compare average scores of Projects and Exams',
      'Show this semester\'s statistics',
      'Find students with scores below 60',
      'Submission activity in the last week',
      'Which student has the most assignments?',
      'View top 10 students by grade'
    ];
  }

  /**
   * Check if AI is configured
   */
  hasAIConfigured() {
    return !!this.apiKey;
  }

  /**
   * Check if initialized
   */
  isInitialized() {
    return this.initialized;
  }
}

// Export singleton
const aiAgent = new AIAgent();
export default aiAgent;
