// fitme-ui/app/sqlite-test.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { DatabaseManager } from '../src/repositories/DatabaseManager';
import { UserRepository } from '../src/repositories/UserRepository';
import { LooksRepository } from '../src/repositories/LooksRepository';
import { SavedPhotosRepository } from '../src/repositories/SavedPhotosRepository';
import { AVARepository } from '../src/repositories/AVARepository';
import { ProductRepository } from '../src/repositories/ProductRepository';
import { SyncOutboxRepository } from '../src/repositories/SyncOutboxRepository';

interface TestResult {
  group: string;
  name: string;
  passed: boolean;
  message?: string;
  durationMs?: number;
}

interface BenchmarkResult {
  operation: string;
  totalMs: number;
  avgMs: number;
  iterations: number;
}

export default function SQLiteTestScreen() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkResult[]>([]);
  const [summary, setSummary] = useState<{ total: number; passed: number; failed: number } | null>(null);

  useEffect(() => {
    runAllTests();
  }, []);

  const runAllTests = async () => {
    setRunning(true);
    setResults([]);
    setBenchmarks([]);
    setSummary(null);

    const testLogs: TestResult[] = [];
    const benchLogs: BenchmarkResult[] = [];

    const record = (group: string, name: string, passed: boolean, message?: string, durationMs?: number) => {
      const item: TestResult = { group, name, passed, message, durationMs };
      testLogs.push(item);
      const icon = passed ? '✅ PASS' : '❌ FAIL';
      console.log(`[SQLITE_TEST] ${icon}: [${group}] ${name} ${message ? `(${message})` : ''}`);
    };

    try {
      console.log('====================================================');
      console.log('[SQLITE_TEST] STARTING EXPO-SQLITE RUNTIME VERIFICATION');
      console.log('====================================================');

      // 1. User ID Validation
      const testGroup1 = 'User ID Validation';
      try {
        const uid = DatabaseManager.getActiveUserId();
        record(testGroup1, 'Initial active user is null', uid === null);
      } catch (e: any) {
        record(testGroup1, 'Initial active user check', false, e.message);
      }

      // 2. Database Open & Migration V1 for User A
      const testGroup2 = 'Database Open & Migration V1';
      const userA = '8191ee1c-5894-4937-a6d9-02e4ad0f7abd';
      const startOpenA = performance.now();
      await DatabaseManager.openUserDatabase(userA);
      const openADuration = performance.now() - startOpenA;
      record(testGroup2, 'Open Database for User A', DatabaseManager.getActiveUserId() === userA, `took ${openADuration.toFixed(2)} ms`, openADuration);

      // Verify PRAGMAs
      const dbA = DatabaseManager.getDatabase();
      const journalMode = await dbA.getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode;');
      record(testGroup2, 'PRAGMA journal_mode = WAL', journalMode?.journal_mode?.toLowerCase() === 'wal', `mode: ${journalMode?.journal_mode}`);

      const foreignKeys = await dbA.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys;');
      record(testGroup2, 'PRAGMA foreign_keys = ON', foreignKeys?.foreign_keys === 1, `value: ${foreignKeys?.foreign_keys}`);

      const schemaVer = await dbA.getFirstAsync<{ value: string }>('SELECT value FROM sync_metadata WHERE key = ?;', ['schema_version']);
      record(testGroup2, 'Migration V1 Schema Version = 1', schemaVer?.value === '1', `version: ${schemaVer?.value}`);

      // 3. User Repository CRUD
      const testGroup3 = 'User Repository CRUD';
      await UserRepository.upsertUser({
        id: userA,
        email: 'user_a@fitme.com',
        full_name: 'User A Verified',
        try_on_count: 5,
        saved_count: 2,
        is_premium: true,
      });

      const fetchedUserA = await UserRepository.getUser(userA);
      record(testGroup3, 'Insert & Retrieve User A Profile', fetchedUserA?.email === 'user_a@fitme.com' && fetchedUserA.is_premium === true);

      await UserRepository.updateCounters(6, 3);
      const updatedUserA = await UserRepository.getUser(userA);
      record(testGroup3, 'Update User A Counters', updatedUserA?.try_on_count === 6 && updatedUserA.saved_count === 3);

      // 4. Try-On Jobs Lifecycle & States
      const testGroup4 = 'Try-On Lifecycle & State Machine';
      const job1Id = 'job-expo-001';
      await LooksRepository.insertTryOnJob({
        local_id: job1Id,
        garment_id: 'garment-101',
        brand_id: 'brand-201',
        status: 'queued',
        result_image_urls: [],
        local_image_paths: [],
      });

      const queuedJob = await LooksRepository.getLookById(job1Id);
      record(testGroup4, 'Insert Try-On (queued with empty results)', queuedJob?.status === 'queued' && queuedJob.result_image_urls.length === 0);

      await LooksRepository.updateTryOnStatus(job1Id, 'processing', { server_id: 'srv-101' });
      const procJob = await LooksRepository.getLookById(job1Id);
      record(testGroup4, 'Transition to processing with server_id', procJob?.status === 'processing' && procJob.server_id === 'srv-101');

      await LooksRepository.updateTryOnStatus(job1Id, 'completed', {
        result_image_urls: ['https://storage.supabase.co/results/101.jpg'],
        local_image_paths: ['file:///local/tryons/101.jpg'],
      });
      const compJob = await LooksRepository.getLookById(job1Id);
      record(testGroup4, 'Transition to completed with local/remote paths', compJob?.status === 'completed' && compJob.result_image_urls.length === 1);

      const toggledFav = await LooksRepository.toggleSave(job1Id);
      record(testGroup4, 'Toggle Favorite (is_saved = true)', toggledFav === true);

      const savedLooks = await LooksRepository.getSavedLooks(10, 0);
      record(testGroup4, 'Get Saved Looks Pagination', savedLooks.length === 1 && savedLooks[0].local_id === job1Id);

      // 5. Saved Photos Repository
      const testGroup5 = 'Saved Photos CRUD';
      const photoId = 'photo-expo-001';
      await SavedPhotosRepository.savePhoto({
        id: photoId,
        storage_path: 'user-photos/a/hash1.jpg',
        local_file_uri: 'file:///local/photos/hash1.jpg',
        display_name: 'Summer Look Original',
        content_hash: 'sha256hash1',
      });

      const photos = await SavedPhotosRepository.getPhotos();
      record(testGroup5, 'Save and Retrieve Model Photo', photos.length === 1 && photos[0].display_name === 'Summer Look Original');

      await SavedPhotosRepository.renamePhoto(photoId, 'Summer Look Renamed');
      const renamedPhoto = await SavedPhotosRepository.getPhotoById(photoId);
      record(testGroup5, 'Rename Model Photo', renamedPhoto?.display_name === 'Summer Look Renamed' && renamedPhoto._sync_status === 'pending_rename');

      // 6. AVA Repository
      const testGroup6 = 'AVA Conversations & History';
      const convId = 'conv-expo-001';
      await AVARepository.createConversation(convId, 'Summer Styling');
      await AVARepository.addMessage('msg-1', convId, 'user', 'Find me lightweight shirts');
      await AVARepository.addMessage('msg-2', convId, 'ava', 'Here are 3 linen shirts', [{ id: 'p1' }], 'recommendation');

      const messages = await AVARepository.getMessages(convId);
      record(testGroup6, 'AVA Chronological Messages', messages.length === 2 && messages[0].sender === 'user' && messages[1].sender === 'ava');

      // 7. Product Cache Tier 0
      const testGroup7 = 'Product Cache Tier 0';
      const productKey = 'myntra:123456';
      await ProductRepository.setCachedProduct(productKey, 'https://myntra.com/123456', 'Linen Shirt', 'https://img.com/1.jpg', { id: 'p1' }, 60000);
      const cachedProd = await ProductRepository.getCachedProduct(productKey);
      record(testGroup7, 'Product Cache Store & Read', cachedProd?.title === 'Linen Shirt');

      // 8. Sync Outbox
      const testGroup8 = 'Sync Outbox Queue';
      const outboxId = 'outbox-expo-001';
      await SyncOutboxRepository.enqueueMutation(outboxId, 'user_saved_photo', photoId, 'UPDATE', { display_name: 'Summer Look Renamed' });
      const pendingMutations = await SyncOutboxRepository.peekPending(10);
      record(testGroup8, 'Outbox Enqueue & Peek', pendingMutations.length === 1 && pendingMutations[0].id === outboxId);

      await SyncOutboxRepository.markFailed(outboxId, 'Simulated Timeout', 10000);
      const lockedPeek = await SyncOutboxRepository.peekPending(10);
      record(testGroup8, 'Outbox Backoff Lock Excludes Item', lockedPeek.length === 0);

      await SyncOutboxRepository.markCompleted([outboxId]);
      const clearedCount = await SyncOutboxRepository.getPendingCount();
      record(testGroup8, 'Outbox Mark Completed & Clear', clearedCount === 0);

      // 9. Atomic Transactions & Rollback
      const testGroup9 = 'Atomic Transactions & Rollback';
      try {
        await DatabaseManager.withTransaction(async (txDb) => {
          await txDb.runAsync('UPDATE users SET try_on_count = 999 WHERE id = ?;', [userA]);
          throw new Error('Simulated transaction abort');
        });
      } catch (_) {}

      const userAfterRollback = await UserRepository.getUser(userA);
      record(testGroup9, 'Transaction Rollback (try_on_count restored to 6, not 999)', userAfterRollback?.try_on_count === 6);

      // Successful transaction
      await DatabaseManager.withTransaction(async (txDb) => {
        await txDb.runAsync('UPDATE users SET try_on_count = 7 WHERE id = ?;', [userA]);
      });
      const userAfterCommit = await UserRepository.getUser(userA);
      record(testGroup9, 'Transaction Commit (try_on_count updated to 7)', userAfterCommit?.try_on_count === 7);

      // 10. Multi-Account Isolation (A -> B -> A and A -> B -> C)
      const testGroup10 = 'Multi-Account Physical & Logical Isolation';
      const userB = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
      await DatabaseManager.openUserDatabase(userB);
      record(testGroup10, 'Mount Account B Database', DatabaseManager.getActiveUserId() === userB);

      // Verify Account B has 0 records from Account A
      const bUser = await UserRepository.getUser(userB);
      const bLooks = await LooksRepository.getGeneratedLooks();
      const bPhotos = await SavedPhotosRepository.getPhotos();
      record(testGroup10, 'Account B sees ZERO records from Account A', bUser === null && bLooks.length === 0 && bPhotos.length === 0);

      // Insert Account B data
      await UserRepository.upsertUser({ id: userB, email: 'user_b@fitme.com', full_name: 'User B', try_on_count: 1, is_premium: false });
      await LooksRepository.insertTryOnJob({ local_id: 'job-b-001', garment_id: 'g-99', status: 'completed' });
      const bUserRecord = await UserRepository.getUser(userB);
      record(testGroup10, 'Insert and Verify Account B Data', bUserRecord?.email === 'user_b@fitme.com');

      // Reopen Account A (A -> B -> A)
      await DatabaseManager.openUserDatabase(userA);
      record(testGroup10, 'Reopen Account A Database (A -> B -> A)', DatabaseManager.getActiveUserId() === userA);
      const aUserReopened = await UserRepository.getUser(userA);
      const aLooksReopened = await LooksRepository.getGeneratedLooks();
      const bUserInA = await UserRepository.getUser(userB);
      record(testGroup10, 'Account A Data Intact upon Reopening', aUserReopened?.email === 'user_a@fitme.com' && aUserReopened.try_on_count === 7 && aLooksReopened.length === 1);
      record(testGroup10, 'Account B Data ABSENT from Account A', bUserInA === null);

      // Open Account C (A -> B -> C)
      const userC = '99999999-9999-9999-9999-999999999999';
      await DatabaseManager.openUserDatabase(userC);
      record(testGroup10, 'Mount Fresh Account C Database (A -> B -> C)', DatabaseManager.getActiveUserId() === userC);
      const cUser = await UserRepository.getUser(userC);
      const cLooks = await LooksRepository.getGeneratedLooks();
      record(testGroup10, 'Account C Database Starts Completely Clean', cUser === null && cLooks.length === 0);

      // 11. Real Native SQLite Benchmarks (100 iterations)
      const testGroup11 = 'Native expo-sqlite Benchmarks';
      await DatabaseManager.openUserDatabase(userA);
      const benchDb = DatabaseManager.getDatabase();
      const iterations = 100;

      // 11.1 Batch Insert
      const startInsert = performance.now();
      await DatabaseManager.withTransaction(async (txDb) => {
        for (let i = 0; i < iterations; i++) {
          await txDb.runAsync(
            `INSERT INTO tryon_jobs (local_id, server_id, user_id, garment_id, status, result_image_urls, local_image_paths, created_at, _sync_status, _local_updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [`bench-${i}`, null, userA, `garment-${i}`, 'completed', '[]', '[]', Date.now(), 'synced', Date.now()]
          );
        }
      });
      const insertTotalMs = performance.now() - startInsert;
      benchLogs.push({ operation: '100-Row Batch Insert', totalMs: insertTotalMs, avgMs: insertTotalMs / iterations, iterations });
      record(testGroup11, '100-Row Batch Insert', insertTotalMs < 500, `${insertTotalMs.toFixed(2)} ms total (${(insertTotalMs / iterations).toFixed(3)} ms/row)`, insertTotalMs);

      // 11.2 Indexed Read
      const startRead = performance.now();
      for (let i = 0; i < iterations; i++) {
        await benchDb.getAllAsync('SELECT * FROM tryon_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20 OFFSET 0;', [userA]);
      }
      const readTotalMs = performance.now() - startRead;
      benchLogs.push({ operation: 'Indexed Read Query (20 rows)', totalMs: readTotalMs, avgMs: readTotalMs / iterations, iterations });
      record(testGroup11, 'Indexed Read Query', readTotalMs / iterations < 10, `${readTotalMs.toFixed(2)} ms total (${(readTotalMs / iterations).toFixed(3)} ms/query)`, readTotalMs);

      // 11.3 100 Updates
      const startUpdate = performance.now();
      await DatabaseManager.withTransaction(async (txDb) => {
        for (let i = 0; i < iterations; i++) {
          await txDb.runAsync('UPDATE tryon_jobs SET is_saved = 1 WHERE local_id = ?;', [`bench-${i}`]);
        }
      });
      const updateTotalMs = performance.now() - startUpdate;
      benchLogs.push({ operation: '100 Updates (withTransaction)', totalMs: updateTotalMs, avgMs: updateTotalMs / iterations, iterations });
      record(testGroup11, '100 Updates in Transaction', updateTotalMs < 500, `${updateTotalMs.toFixed(2)} ms total (${(updateTotalMs / iterations).toFixed(3)} ms/update)`, updateTotalMs);

      // 11.4 Delete All
      const startDelete = performance.now();
      await benchDb.runAsync('DELETE FROM tryon_jobs WHERE local_id LIKE ?;', ['bench-%']);
      const deleteTotalMs = performance.now() - startDelete;
      benchLogs.push({ operation: 'Bulk Delete 100 rows', totalMs: deleteTotalMs, avgMs: deleteTotalMs, iterations: 1 });
      record(testGroup11, 'Bulk Delete 100 rows', deleteTotalMs < 100, `${deleteTotalMs.toFixed(2)} ms`, deleteTotalMs);

      // Close database
      const startClose = performance.now();
      await DatabaseManager.closeActiveDatabase();
      const closeTotalMs = performance.now() - startClose;
      benchLogs.push({ operation: 'Database Close', totalMs: closeTotalMs, avgMs: closeTotalMs, iterations: 1 });
      record(testGroup11, 'Database Close Cleanly', DatabaseManager.getActiveUserId() === null, `${closeTotalMs.toFixed(2)} ms`, closeTotalMs);

      const passed = testLogs.filter((t) => t.passed).length;
      const failed = testLogs.filter((t) => !t.passed).length;
      setSummary({ total: testLogs.length, passed, failed });
      console.log('====================================================');
      console.log(`[SQLITE_TEST] SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${testLogs.length})`);
      console.log('====================================================');
    } catch (globalErr: any) {
      console.error('[SQLITE_TEST] FATAL SUITE ERROR:', globalErr);
      record('Fatal Suite Error', 'Unhandled Exception', false, globalErr?.message || String(globalErr));
    } finally {
      setResults(testLogs);
      setBenchmarks(benchLogs);
      setRunning(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>FitMe expo-sqlite Runtime Verification</Text>
      <Text style={styles.subtitle}>Phase 1B Native Engine Tests & Benchmarks</Text>

      {running && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#FF3B30" />
          <Text style={styles.loadingText}>Executing expo-sqlite native tests...</Text>
        </View>
      )}

      {summary && (
        <View style={[styles.summaryCard, summary.failed === 0 ? styles.summaryPass : styles.summaryFail]}>
          <Text style={styles.summaryTitle}>
            {summary.failed === 0 ? '🎉 ALL TESTS PASSED' : `⚠️ ${summary.failed} TESTS FAILED`}
          </Text>
          <Text style={styles.summaryStats}>
            {summary.passed} / {summary.total} Passed ({((summary.passed / summary.total) * 100).toFixed(1)}%)
          </Text>
        </View>
      )}

      {benchmarks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⏱️ Real Native Benchmarks</Text>
          {benchmarks.map((b, idx) => (
            <View key={idx} style={styles.benchRow}>
              <Text style={styles.benchName}>{b.operation}</Text>
              <Text style={styles.benchValue}>
                {b.totalMs.toFixed(2)} ms ({b.avgMs.toFixed(3)} ms/op)
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📋 Test Assertions ({results.length})</Text>
        {results.map((r, idx) => (
          <View key={idx} style={styles.testRow}>
            <Text style={r.passed ? styles.passIcon : styles.failIcon}>{r.passed ? '✓' : '✗'}</Text>
            <View style={styles.testInfo}>
              <Text style={styles.testGroup}>[{r.group}]</Text>
              <Text style={styles.testName}>{r.name}</Text>
              {r.message ? <Text style={styles.testMessage}>{r.message}</Text> : null}
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.rerunButton} onPress={runAllTests} disabled={running}>
        <Text style={styles.rerunButtonText}>{running ? 'Running...' : 'Rerun All Tests'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B0E' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#8E8E93', marginBottom: 20 },
  loadingBox: { padding: 20, alignItems: 'center', backgroundColor: '#1C1C1E', borderRadius: 12, marginBottom: 20 },
  loadingText: { color: '#EBEBF5', marginTop: 10, fontSize: 14 },
  summaryCard: { padding: 18, borderRadius: 12, marginBottom: 20, alignItems: 'center' },
  summaryPass: { backgroundColor: '#1A3826', borderColor: '#34C759', borderWidth: 1 },
  summaryFail: { backgroundColor: '#3D1A1A', borderColor: '#FF3B30', borderWidth: 1 },
  summaryTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  summaryStats: { fontSize: 14, color: '#EBEBF5', marginTop: 4 },
  section: { backgroundColor: '#16161A', borderRadius: 12, padding: 16, marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 12 },
  benchRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#24242A' },
  benchName: { fontSize: 13, color: '#D1D1D6', flex: 1 },
  benchValue: { fontSize: 13, fontWeight: '600', color: '#30D158' },
  testRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#24242A', alignItems: 'flex-start' },
  passIcon: { color: '#34C759', fontSize: 16, fontWeight: '800', marginRight: 10, marginTop: 2 },
  failIcon: { color: '#FF3B30', fontSize: 16, fontWeight: '800', marginRight: 10, marginTop: 2 },
  testInfo: { flex: 1 },
  testGroup: { fontSize: 11, color: '#8E8E93', fontWeight: '600' },
  testName: { fontSize: 13, color: '#FFFFFF', marginTop: 2 },
  testMessage: { fontSize: 11, color: '#A1A1A6', marginTop: 2 },
  rerunButton: { backgroundColor: '#FF3B30', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  rerunButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
