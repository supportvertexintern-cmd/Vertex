import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:vertex_app/core/auth/auth_manager.dart';
import 'package:vertex_app/core/auth/candidate_store.dart';
import 'package:vertex_app/core/auth/case_store.dart';
import 'package:vertex_app/core/auth/token_store.dart';
import 'package:vertex_app/data/repositories/candidate_repository.dart';
import 'package:vertex_app/data/repositories/case_repository.dart';
import 'package:vertex_app/data/repositories/intake_repository.dart';
import 'package:vertex_app/data/services/api_service.dart';
import 'package:vertex_app/data/services/auth_api.dart';

import 'support/fake_server.dart';

// The recruiter's real data: candidates and cases from FastAPI, scoped
// there; the intake form's options, uploads and submission. Nothing is
// kept only on the phone.

/// A candidate row as GET /api/v1/candidates sends it (pipeline_reads.py).
Map<String, dynamic> candidateRow({String id = 'c1', String? name = 'Amina Yusuf', String? jobTitle = 'Welder'}) => {
      'id': id,
      'full_name': name,
      'nationality': 'Kenyan',
      'gender': 'female',
      'phone': '+254 700 000000',
      'email': 'amina@test.invalid',
      'desired_role': 'Fabricator',
      'lifecycle_status': 'submitted',
      'created_at': '2026-11-20T09:30:00.000Z',
      'user': null,
      'applications': [
        if (jobTitle != null) {'job': {'title': jobTitle}},
      ],
    };

/// A case row as GET /api/v1/cases sends it (case_reads.py).
Map<String, dynamic> caseRow({String id = 'k1', String status = 'active', String stage = 'permit_processing_followup'}) => {
      'id': id,
      'status': status,
      'current_stage': stage,
      'created_at': '2026-11-01T10:00:00.000Z',
      'application': {
        'candidate': {'full_name': null, 'nationality': 'Ghanaian', 'user': {'full_name': 'Kofi Mensah'}},
        'job': {'title': 'Driver', 'country': 'Poland', 'city': 'Gdansk'},
      },
    };

void main() {
  late FakeServer web;
  late FakeServer backend;
  late AuthManager auth;
  late ApiService api;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    web = FakeServer();
    backend = FakeServer();
    auth = AuthManager(
      api: AuthApi(baseUrl: 'http://web.test', dio: Dio(BaseOptions(baseUrl: 'http://web.test'))..httpClientAdapter = web),
      store: MemoryTokenStore(),
    );
    api = ApiService(
      baseUrl: 'http://api.test/api/v1',
      auth: auth,
      dio: Dio(BaseOptions(baseUrl: 'http://api.test/api/v1'))..httpClientAdapter = backend,
    );
    web.only('/api/auth/app/login', 200, session(role: 'regional_recruiter'));
    await auth.signIn(email: 'x@test.invalid', password: 'pw');
  });

  group('the records read the server rows', () {
    test('a candidate: their name, the programme applied for, when', () {
      final c = CandidateRecord.fromJson(candidateRow());
      expect((c.fullName, c.opportunity, c.nationality, c.status), ('Amina Yusuf', 'Welder', 'Kenyan', 'submitted'));
      expect(c.registeredAt.toUtc(), DateTime.utc(2026, 11, 20, 9, 30));
      // No application yet: the role they want.
      expect(CandidateRecord.fromJson(candidateRow(jobTitle: null)).opportunity, 'Fabricator');
    });

    test("a case: the candidate's account name, the place, the stage in words", () {
      final k = CaseRecord.fromJson(caseRow());
      expect((k.candidateName, k.destination, k.jobTitle, k.stage, k.status), ('Kofi Mensah', 'Gdansk, Poland', 'Driver', 'Permit processing', CaseStatus.active));
      expect(CaseRecord.fromJson(caseRow(status: 'rejected')).status, CaseStatus.rejected);
    });
  });

  group('the stores load from FastAPI', () {
    test("candidates: the recruiter's own, as FastAPI scopes them", () async {
      backend.on('/candidates', 200, {'data': [candidateRow(), candidateRow(id: 'c2', name: 'Ben')], 'total': 2, 'page': 1, 'pageSize': 50});
      final store = CandidateStore(CandidateRepository(api));
      await store.load();
      expect(store.records.map((r) => r.id), ['c1', 'c2']);
      expect((store.total, store.hasLoaded, store.loadError), (2, true, null));
      expect(backend.requests.single.headers['Authorization'], 'Bearer access-1');
    });

    test('cases: active and rejected alike', () async {
      backend.on('/cases', 200, {'data': [caseRow()], 'total': 1, 'page': 1, 'pageSize': 50});
      final store = CaseStore(CaseRepository(api));
      await store.load();
      expect(store.records.single.stage, 'Permit processing');
      expect(backend.requests.single.queryParameters['status'], 'all');
    });

    test('a failure is a message to show, not stale records', () async {
      backend.on('/candidates', 503, {'error': {'code': 'unavailable', 'message': 'Try again shortly.'}});
      final store = CandidateStore(CandidateRepository(api));
      await store.load();
      expect(store.records, isEmpty);
      expect((store.loadError, store.hasLoaded), ('Try again shortly.', false));
    });

    test("signing out empties them, and a load that was under way doesn't refill them", () async {
      backend.on('/candidates', 200, {'data': [candidateRow()], 'total': 1, 'page': 1, 'pageSize': 50});
      final store = CandidateStore(CandidateRepository(api));
      final loading = store.load();
      store.clear(); // signed out while the answer was on its way
      await loading;
      expect(store.records, isEmpty);
      expect((store.total, store.hasLoaded), (0, false));
    });
  });

  group('the intake form', () {
    final options = IntakeOptions.fromJson({
      'countries': [{'id': 'pl', 'name': 'Poland'}],
      'locationCountries': [{'id': 'ke', 'name': 'Kenya'}],
      'documentTypes': [
        {'key': 'passport', 'label': 'Passport', 'is_universal': true},
        {'key': 'photo', 'label': 'Photo', 'is_universal': true},
        {'key': 'cv', 'label': 'CV', 'is_universal': true},
        {'key': 'police_clearance', 'label': 'Police clearance', 'is_universal': false},
        {'key': 'payment_receipt_stage_1', 'label': 'Receipt', 'is_universal': true},
      ],
      'documentRequirements': [{'country_id': 'pl', 'document_type': 'police_clearance'}],
    });
    const poland = JobOption(id: 'j1', title: 'Welder', country: 'Poland', city: 'Gdansk');

    test("asks for the documents FastAPI requires: the universal ones and the destination's, not the CV or receipts", () {
      expect(options.requiredFor(poland).map((t) => t.key), ['passport', 'photo', 'police_clearance']);
      const elsewhere = JobOption(id: 'j2', title: 'Cook', country: 'Malta', city: '');
      expect(options.requiredFor(elsewhere).map((t) => t.key), ['passport', 'photo']);
      expect(options.locations, ['Kenya', 'Poland']);
    });

    test('uploads a document to the web app and keeps its receipt', () async {
      web.only('/api/upload', 200, {'documentId': 'd1', 'intake_token': 'receipt-1'});
      final uploads = IntakeUploads(baseUrl: 'http://web.test', dio: Dio(BaseOptions(baseUrl: 'http://web.test'))..httpClientAdapter = web);
      final receipt = await uploads.upload(type: 'passport', bytes: [1, 2, 3], fileName: 'passport.jpg', mimeType: 'image/jpeg');
      expect((receipt.documentId, receipt.token), ('d1', 'receipt-1'));
      final sent = web.requests.last;
      expect(sent.queryParameters, {'intake': '1', 'type': 'passport'});
      expect(sent.data, isA<FormData>());
      expect(sent.headers['Authorization'], isNull); // the intake upload needs no session
    });

    test("an upload the server refuses is its message (too large, wrong kind, too many)", () async {
      web.only('/api/upload', 400, {'error': 'File too large. Maximum size is 5MB.'});
      final uploads = IntakeUploads(baseUrl: 'http://web.test', dio: Dio(BaseOptions(baseUrl: 'http://web.test'))..httpClientAdapter = web);
      expect(
        () => uploads.upload(type: 'photo', bytes: [1], fileName: 'p.jpg', mimeType: 'image/jpeg'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', 'File too large. Maximum size is 5MB.')),
      );
    });

    test('submits the application to FastAPI with the receipts', () async {
      backend.on('/applications/submit', 201, {'data': {'id': 'a1'}});
      await IntakeRepository(api).submit({'job_id': 'j1', 'document_tokens': ['receipt-1']});
      expect(backend.requests.single.method, 'POST');
      expect(backend.bodies.single, {'job_id': 'j1', 'document_tokens': ['receipt-1']});
    });

    test("FastAPI's refusal (a missing document, an active application) comes back to show", () async {
      backend.on('/applications/submit', 422, {
        'error': {'code': 'missing_documents', 'message': 'Please attach the required documents for this programme: Passport.'},
      });
      expect(
        () => IntakeRepository(api).submit({'job_id': 'j1'}),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'missing_documents')),
      );
    });
  });
}
