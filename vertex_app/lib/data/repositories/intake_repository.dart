import 'package:dio/dio.dart';

import '../services/api_service.dart';

/// The Candidate Information Form's server side, for a recruiter entering a
/// lead in the app: the same endpoints as the website's form.
///
/// - [options]: destinations, document types and each destination's extra
///   documents (GET /api/v1/apply/options).
/// - [jobs]: the open programmes (GET /api/v1/jobs).
/// - [IntakeUploads.upload]: each document, before the form is sent, through
///   the web app's /api/upload?intake=1, which scans and stores it and
///   answers with a short-lived receipt (FastAPI takes intake uploads from
///   the web app only).
/// - [submit]: the application with those receipts (POST
///   /api/v1/applications/submit), which creates the candidate with the
///   recruiter as theirs. FastAPI refuses it without the programme's
///   documents, whoever sends it.
class IntakeRepository {
  const IntakeRepository(this._api);
  final ApiService _api;

  Future<IntakeOptions> options() async => IntakeOptions.fromJson(await _api.get('/apply/options') as Map<String, dynamic>);

  Future<List<JobOption>> jobs() async {
    final data = await _api.get('/jobs', query: {'limit': 50}) as Map<String, dynamic>;
    return (data['jobs'] as List? ?? const []).whereType<Map<String, dynamic>>().map(JobOption.fromJson).toList();
  }

  Future<void> submit(Map<String, dynamic> body) => _api.post('/applications/submit', body);
}

class JobOption {
  const JobOption({required this.id, required this.title, required this.country, required this.city});

  factory JobOption.fromJson(Map<String, dynamic> json) => JobOption(
        id: json['id'] as String,
        title: json['title'] as String? ?? '',
        country: json['country'] as String? ?? '',
        city: json['city'] as String? ?? '',
      );

  final String id;
  final String title;
  final String country;
  final String city;

  String get label => [country, title].where((s) => s.isNotEmpty).join(' · ');
}

class DocumentTypeOption {
  const DocumentTypeOption({required this.key, required this.label, required this.isUniversal});

  final String key;
  final String label;
  final bool isUniversal;
}

/// The form's reference data (ApplyOptions in vertex_be/app/api/v1/public.py).
class IntakeOptions {
  const IntakeOptions({required this.destinations, required this.locations, required this.documentTypes, required this.requirements});

  factory IntakeOptions.fromJson(Map<String, dynamic> json) {
    List<Map<String, dynamic>> rows(String key) => (json[key] as List? ?? const []).whereType<Map<String, dynamic>>().toList();
    final requirements = <String, Set<String>>{};
    for (final r in rows('documentRequirements')) {
      requirements.putIfAbsent(r['country_id'] as String, () => {}).add(r['document_type'] as String);
    }
    return IntakeOptions(
      destinations: {for (final c in rows('countries')) c['id'] as String: c['name'] as String},
      locations: [for (final c in [...rows('locationCountries'), ...rows('countries')]) c['name'] as String]..sort(),
      documentTypes: [
        for (final t in rows('documentTypes'))
          DocumentTypeOption(key: t['key'] as String, label: t['label'] as String? ?? t['key'] as String, isUniversal: t['is_universal'] == true),
      ],
      requirements: requirements,
    );
  }

  /// Destination country id -> name.
  final Map<String, String> destinations;

  /// Every country by name, for where the candidate is now.
  final List<String> locations;
  final List<DocumentTypeOption> documentTypes;

  /// Destination country id -> its extra document types.
  final Map<String, Set<String>> requirements;

  // Collected elsewhere, never on this form (NON_PROGRAMME_TYPE_KEYS and the
  // payment receipts in vertex_be/app/services/documents.py).
  static const _notOnTheForm = {'cv', 'transcript', 'certificate', 'medical', 'contract', 'visa', 'other', 'issued_work_permit', 'issued_visa'};
  static bool _onTheForm(String key) => !_notOnTheForm.contains(key) && key != 'payment_receipt' && !key.startsWith('payment_receipt_');

  /// What the form must carry for [job]: the universal types and its
  /// destination's extras, as FastAPI checks (required_programme_documents).
  List<DocumentTypeOption> requiredFor(JobOption job) {
    final countryId = destinations.entries.where((e) => e.value.toLowerCase() == job.country.toLowerCase()).map((e) => e.key).firstOrNull;
    final extras = countryId == null ? const <String>{} : requirements[countryId] ?? const <String>{};
    return documentTypes.where((t) => (t.isUniversal || extras.contains(t.key)) && _onTheForm(t.key)).toList();
  }
}

/// A document uploaded for the form: what [IntakeRepository.submit] presents.
class IntakeReceipt {
  const IntakeReceipt({required this.documentId, required this.token});
  final String documentId;
  final String token;
}

/// The web app's intake upload (vertex/src/app/api/upload/route.ts, ?intake=1):
/// public and rate-limited there, so it needs no session.
class IntakeUploads {
  IntakeUploads({required String baseUrl, Dio? dio})
      : _dio = dio ?? Dio(BaseOptions(baseUrl: baseUrl, connectTimeout: const Duration(seconds: 15), receiveTimeout: const Duration(seconds: 90))) {
    _dio.options.validateStatus = (_) => true;
  }

  final Dio _dio;

  /// Uploads one file of document [type]; throws [ApiException] with a
  /// message to show (too large, wrong kind, rate-limited, offline).
  Future<IntakeReceipt> upload({required String type, required List<int> bytes, required String fileName, required String mimeType}) async {
    final Response<dynamic> res;
    try {
      res = await _dio.post<dynamic>(
        '/api/upload',
        queryParameters: {'intake': '1', 'type': type},
        data: FormData.fromMap({'file': MultipartFile.fromBytes(bytes, filename: fileName, contentType: DioMediaType.parse(mimeType))}),
      );
    } on DioException {
      throw const ApiException(0, 'network_error', "Couldn't reach Vertex. Check your connection and try again.");
    }
    final body = res.data;
    if (res.statusCode == 200 && body is Map && body['intake_token'] is String) {
      return IntakeReceipt(documentId: body['documentId'] as String? ?? '', token: body['intake_token'] as String);
    }
    throw ApiException.fromResponse(res.statusCode ?? 0, body);
  }
}
