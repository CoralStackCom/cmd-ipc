/**
 * A Map with optional TTL-based automatic cleanup of stale entries.
 *
 * @typeParam K - Key type
 * @typeParam V - Value type
 */
export class TTLMap<K, V> {
  private _map: Map<K, { value: V; timestamp: number }> = new Map()
  private _ttl: number
  private _onExpire?: (key: K, value: V) => void
  private _cleanupInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Create a new TTLMap
   *
   * @param ttl - Time-to-live in milliseconds. If 0, no automatic cleanup.
   * @param onExpire - Optional callback when entry expires (e.g., to reject promises)
   */
  constructor(ttl: number = 0, onExpire?: (key: K, value: V) => void) {
    this._ttl = ttl
    this._onExpire = onExpire

    if (ttl > 0) {
      this._cleanupInterval = setInterval(() => this._cleanup(), ttl)
      // Don't prevent process exit (Node.js only)

      const interval = this._cleanupInterval as any
      if (typeof interval?.unref === 'function') {
        interval.unref()
      }
    }
  }

  /**
   * Set a value in the map with current timestamp
   */
  set(key: K, value: V): this {
    this._map.set(key, { value, timestamp: Date.now() })
    return this
  }

  /**
   * Get a value from the map (returns undefined if not found or expired)
   */
  get(key: K): V | undefined {
    const entry = this._map.get(key)
    if (!entry) return undefined

    if (this._ttl > 0 && Date.now() - entry.timestamp > this._ttl) {
      if (this._onExpire) this._onExpire(key, entry.value)
      this._map.delete(key)
      return undefined
    }
    return entry.value
  }

  /**
   * Check if key exists (and is not expired)
   */
  has(key: K): boolean {
    const entry = this._map.get(key)
    if (!entry) return false

    if (this._ttl > 0 && Date.now() - entry.timestamp > this._ttl) {
      if (this._onExpire) this._onExpire(key, entry.value)
      this._map.delete(key)
      return false
    }
    return true
  }

  /**
   * Delete a key from the map
   */
  delete(key: K): boolean {
    return this._map.delete(key)
  }

  /**
   * Clear all entries from the map (does NOT call onExpire)
   */
  clear(): void {
    this._map.clear()
  }

  /**
   * Get the number of entries (including potentially expired ones)
   */
  get size(): number {
    return this._map.size
  }

  /**
   * Iterate over entries (may include expired entries if cleanup hasn't run)
   */
  forEach(callback: (value: V, key: K) => void): void {
    this._map.forEach((entry, key) => callback(entry.value, key))
  }

  /**
   * Clean up expired entries
   */
  private _cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this._map) {
      if (now - entry.timestamp > this._ttl) {
        if (this._onExpire) this._onExpire(key, entry.value)
        this._map.delete(key)
      }
    }
  }

  /**
   * Stop the cleanup interval and clear all entries.
   * Call this when the map is no longer needed.
   */
  dispose(): void {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval)
      this._cleanupInterval = null
    }
    this._map.clear()
  }
}
