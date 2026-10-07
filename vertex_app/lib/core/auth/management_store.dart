import 'package:flutter/foundation.dart';

class CampaignTarget {
  CampaignTarget({
    required this.id,
    required this.metric,
    required this.targetValue,
    this.countryName,
    this.regionName,
  });

  final String id;
  final String metric;
  final num targetValue;
  final String? countryName;
  final String? regionName;

  String get scopeLabel => countryName ?? regionName ?? 'Campaign-wide';
}

class ManagementCampaign {
  ManagementCampaign({
    required this.id,
    required this.name,
    required this.status,
    required this.startDate,
    required this.endDate,
    required this.creatorName,
    required this.targets,
    this.notes,
  });

  final String id;
  final String name;
  String status;
  final DateTime startDate;
  final DateTime endDate;
  final String creatorName;
  final List<CampaignTarget> targets;
  final String? notes;
}

class ManagementPartner {
  ManagementPartner({
    required this.id,
    required this.name,
    required this.partnerType,
    required this.countryOfOperation,
    required this.status,
    required this.mouStatus,
    required this.contactName,
    required this.contactEmail,
    required this.contactPhone,
    this.businessRegNumber,
    this.notes,
    this.userId,
    required this.candidatesSourcedCount,
  });

  final String id;
  final String partnerType;
  String name;
  String countryOfOperation;
  String status;
  String mouStatus;
  String contactName;
  String contactEmail;
  String contactPhone;
  final String? businessRegNumber;
  String? notes;
  String? userId;
  final int candidatesSourcedCount;
}

class PartnerCandidate {
  PartnerCandidate({
    required this.id,
    required this.name,
    required this.lifecycleStatus,
    required this.recruiterName,
    required this.createdAt,
  });

  final String id;
  final String name;
  final String lifecycleStatus;
  final String recruiterName;
  final DateTime createdAt;
}

class EmployerClient {
  EmployerClient({
    required this.id,
    required this.name,
    required this.country,
    this.industry,
    required this.contactName,
    required this.contactEmail,
    required this.status,
    required this.jobsCount,
  });

  final String id;
  String name;
  String country;
  final String? industry;
  String contactName;
  String contactEmail;
  String status; // active, inactive
  final int jobsCount;
}

class FeePolicy {
  FeePolicy({
    required this.id,
    this.countryId,
    this.countryName,
    required this.enabled,
    this.documentationAmount,
    this.permitAmount,
    this.visaAmount,
    required this.currency,
    required this.updatedAt,
  });

  final String id;
  final String? countryId;
  final String? countryName;
  bool enabled;
  double? documentationAmount;
  double? permitAmount;
  double? visaAmount;
  final String currency;
  DateTime updatedAt;
}

class ManagementCaseRow {
  ManagementCaseRow({
    required this.id,
    required this.currentStage,
    required this.createdAt,
    required this.updatedAt,
    required this.opsReviewStatus,
    required this.candidateName,
    this.candidateEmail,
    required this.country,
    this.recruiterName,
    this.partnerName,
    required this.jobTitle,
    required this.source,
  });

  final String id;
  final String currentStage;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String opsReviewStatus; // pending, confirmed, rejected
  final String candidateName;
  final String? candidateEmail;
  final String country;
  final String? recruiterName;
  final String? partnerName;
  final String jobTitle;
  final String source; // self_registered, recruiter_sourced, partner_sourced
}

class ManagementStore extends ChangeNotifier {
  static const directorName = 'Director Jane';

  final List<ManagementCampaign> campaigns = () {
    final now = DateTime.now();
    return [
      ManagementCampaign(
        id: '1',
        name: 'Q3 Expansion',
        status: 'active',
        startDate: now.subtract(const Duration(days: 30)),
        endDate: now.add(const Duration(days: 60)),
        creatorName: directorName,
        notes: 'Engineering and production placements across East Africa.',
        targets: [
          CampaignTarget(
              id: 't1',
              metric: 'verified_candidates',
              targetValue: 100,
              countryName: 'Kenya'),
          CampaignTarget(
              id: 't2',
              metric: 'conversion_rate',
              targetValue: 15,
              regionName: 'East Africa'),
        ],
      ),
      ManagementCampaign(
        id: '2',
        name: 'Q4 Healthcare Drive',
        status: 'draft',
        startDate: now.add(const Duration(days: 10)),
        endDate: now.add(const Duration(days: 100)),
        creatorName: directorName,
        notes: 'Healthcare professionals for Germany market.',
        targets: [],
      ),
      ManagementCampaign(
        id: '3',
        name: 'Q2 Coastal Push',
        status: 'closed',
        startDate: now.subtract(const Duration(days: 150)),
        endDate: now.subtract(const Duration(days: 60)),
        creatorName: directorName,
        targets: [
          CampaignTarget(
              id: 't3',
              metric: 'verified_candidates',
              targetValue: 40,
              countryName: 'Kenya'),
        ],
      ),
    ];
  }();

  final List<ManagementPartner> partners = [
    ManagementPartner(
      id: '1',
      name: 'Horizon Travel & Visa Services',
      partnerType: 'travel_agency',
      countryOfOperation: 'Kenya',
      status: 'active',
      mouStatus: 'signed',
      contactName: 'John Doe',
      contactEmail: 'john@horizon.com',
      contactPhone: '+254 700 000000',
      businessRegNumber: 'REG-12345',
      notes: 'Long-standing partner for East Africa placements.',
      userId: 'u1',
      candidatesSourcedCount: 45,
    ),
    ManagementPartner(
      id: '2',
      name: 'Global Manpower Ltd',
      partnerType: 'manpower_supplier',
      countryOfOperation: 'Nigeria',
      status: 'pending',
      mouStatus: 'none',
      contactName: 'Amina Yusuf',
      contactEmail: 'amina@global.com',
      contactPhone: '+234 800 000000',
      candidatesSourcedCount: 0,
    ),
    ManagementPartner(
      id: '3',
      name: 'Kampala Visa Hub',
      partnerType: 'visa_consultancy',
      countryOfOperation: 'Uganda',
      status: 'suspended',
      mouStatus: 'sent',
      contactName: 'Sarah Namuyomba',
      contactEmail: 'sarah@kampalavisahub.ug',
      contactPhone: '+256 700 111222',
      userId: 'u3',
      candidatesSourcedCount: 12,
    ),
  ];

  final Map<String, List<PartnerCandidate>> _partnerCandidates = {
    '1': [
      PartnerCandidate(
        id: 'c1',
        name: 'Brook Teferi',
        lifecycleStatus: 'Verified',
        recruiterName: 'Nairobi City Lead',
        createdAt: DateTime.now().subtract(const Duration(days: 5)),
      ),
      PartnerCandidate(
        id: 'c2',
        name: 'Amina Yusuf',
        lifecycleStatus: 'Pending',
        recruiterName: 'Mombasa Coastal Agent',
        createdAt: DateTime.now().subtract(const Duration(days: 2)),
      ),
    ],
    '3': [
      PartnerCandidate(
        id: 'c3',
        name: 'Grace Wanjiru',
        lifecycleStatus: 'Ready to Depart',
        recruiterName: 'Nairobi City Lead',
        createdAt: DateTime.now().subtract(const Duration(days: 20)),
      ),
    ],
  };

  ManagementPartner? partnerById(String id) {
    for (final partner in partners) {
      if (partner.id == id) return partner;
    }
    return null;
  }

  List<PartnerCandidate> candidatesFor(String partnerId) =>
      _partnerCandidates[partnerId] ?? const [];

  final List<EmployerClient> employerClients = [
    EmployerClient(
      id: 'e1',
      name: 'Gulf Construction Group',
      country: 'Qatar',
      industry: 'Construction',
      contactName: 'Ali Haddad',
      contactEmail: 'hr@gulfconstruction.qa',
      status: 'active',
      jobsCount: 18,
    ),
    EmployerClient(
      id: 'e2',
      name: 'Berlin Care Alliance',
      country: 'Germany',
      industry: 'Healthcare',
      contactName: 'Anna Weber',
      contactEmail: 'careers@berlincare.de',
      status: 'active',
      jobsCount: 9,
    ),
    EmployerClient(
      id: 'e3',
      name: 'NairobiTech Solutions',
      country: 'Kenya',
      industry: 'Technology',
      contactName: 'Brian Kariuki',
      contactEmail: 'hiring@nairobitech.co.ke',
      status: 'inactive',
      jobsCount: 4,
    ),
    EmployerClient(
      id: 'e4',
      name: 'Nordic Home Care AB',
      country: 'Sweden',
      industry: 'Healthcare',
      contactName: 'Lars Nilsson',
      contactEmail: 'jobs@nordichomecare.se',
      status: 'active',
      jobsCount: 12,
    ),
  ];

  final List<FeePolicy> feePolicies = [
    FeePolicy(
      id: 'f1',
      countryId: 'KE',
      countryName: 'Kenya',
      enabled: true,
      documentationAmount: 2500,
      permitAmount: 5000,
      visaAmount: 4500,
      currency: 'KES',
      updatedAt: DateTime.now().subtract(const Duration(days: 12)),
    ),
    FeePolicy(
      id: 'f2',
      countryId: 'NG',
      countryName: 'Nigeria',
      enabled: true,
      documentationAmount: 15000,
      permitAmount: 30000,
      visaAmount: 25000,
      currency: 'NGN',
      updatedAt: DateTime.now().subtract(const Duration(days: 45)),
    ),
    FeePolicy(
      id: 'f3',
      countryId: 'UG',
      countryName: 'Uganda',
      enabled: false,
      documentationAmount: 3000,
      permitAmount: 8000,
      visaAmount: 6000,
      currency: 'UGX',
      updatedAt: DateTime.now().subtract(const Duration(days: 8)),
    ),
    FeePolicy(
      id: 'f4',
      countryId: 'GH',
      countryName: 'Ghana',
      enabled: true,
      documentationAmount: 1200,
      permitAmount: 4000,
      visaAmount: 3500,
      currency: 'GHS',
      updatedAt: DateTime.now().subtract(const Duration(days: 30)),
    ),
  ];

  final List<ManagementCaseRow> managementCases = [
    ManagementCaseRow(
      id: 'mc1',
      currentStage: 'Document Collection',
      createdAt: DateTime.now().subtract(const Duration(days: 9)),
      updatedAt: DateTime.now().subtract(const Duration(days: 1)),
      opsReviewStatus: 'pending',
      candidateName: 'Kofi Mensah',
      candidateEmail: 'kofi.mensah@mail.com',
      country: 'Ghana',
      recruiterName: 'Nairobi City Lead',
      jobTitle: 'Site Engineer',
      source: 'recruiter_sourced',
    ),
    ManagementCaseRow(
      id: 'mc2',
      currentStage: 'Visa Application',
      createdAt: DateTime.now().subtract(const Duration(days: 15)),
      updatedAt: DateTime.now().subtract(const Duration(days: 2)),
      opsReviewStatus: 'confirmed',
      candidateName: 'Amara Okonkwo',
      candidateEmail: 'amara.okonkwo@mail.com',
      country: 'Nigeria',
      partnerName: 'Global Manpower Ltd',
      jobTitle: 'Registered Nurse',
      source: 'partner_sourced',
    ),
    ManagementCaseRow(
      id: 'mc3',
      currentStage: 'Placement',
      createdAt: DateTime.now().subtract(const Duration(days: 40)),
      updatedAt: DateTime.now().subtract(const Duration(days: 6)),
      opsReviewStatus: 'confirmed',
      candidateName: 'Grace Wanjiru',
      candidateEmail: 'grace.wanjiru@mail.com',
      country: 'Kenya',
      recruiterName: 'Mombasa Coastal Agent',
      jobTitle: 'Caregiver',
      source: 'recruiter_sourced',
    ),
    ManagementCaseRow(
      id: 'mc4',
      currentStage: 'Interview',
      createdAt: DateTime.now().subtract(const Duration(days: 21)),
      updatedAt: DateTime.now().subtract(const Duration(days: 9)),
      opsReviewStatus: 'rejected',
      candidateName: 'Daniel Ochieng',
      country: 'Kenya',
      jobTitle: 'Logistics Coordinator',
      source: 'self_registered',
    ),
    ManagementCaseRow(
      id: 'mc5',
      currentStage: 'Offer',
      createdAt: DateTime.now().subtract(const Duration(days: 33)),
      updatedAt: DateTime.now().subtract(const Duration(days: 3)),
      opsReviewStatus: 'pending',
      candidateName: 'Sarah Namuyomba',
      candidateEmail: 'sarah.n@mail.com',
      country: 'Uganda',
      partnerName: 'Kampala Visa Hub',
      jobTitle: 'Accountant',
      source: 'partner_sourced',
    ),
    ManagementCaseRow(
      id: 'mc6',
      currentStage: 'Document Collection',
      createdAt: DateTime.now().subtract(const Duration(days: 4)),
      updatedAt: DateTime.now().subtract(const Duration(hours: 20)),
      opsReviewStatus: 'pending',
      candidateName: 'Emeka Nwosu',
      candidateEmail: 'emeka.nwosu@mail.com',
      country: 'Nigeria',
      recruiterName: 'Lagos Metro Agent',
      jobTitle: 'Heavy Truck Driver',
      source: 'recruiter_sourced',
    ),
  ];

  ManagementCaseRow? managementCaseById(String id) {
    for (final row in managementCases) {
      if (row.id == id) return row;
    }
    return null;
  }

  EmployerClient? employerClientById(String id) {
    for (final client in employerClients) {
      if (client.id == id) return client;
    }
    return null;
  }

  FeePolicy? feePolicyById(String id) {
    for (final policy in feePolicies) {
      if (policy.id == id) return policy;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Employer Clients
  // -------------------------------------------------------------------------
  void addEmployerClient({
    required String name,
    required String country,
    String? industry,
    required String contactName,
    required String contactEmail,
  }) {
    employerClients.insert(
      0,
      EmployerClient(
        id: 'ec${DateTime.now().millisecondsSinceEpoch}',
        name: name,
        country: country,
        industry: industry,
        contactName: contactName,
        contactEmail: contactEmail,
        status: 'active',
        jobsCount: 0,
      ),
    );
    notifyListeners();
  }

  void setClientStatus(String clientId, String status) {
    final client = employerClientById(clientId);
    if (client == null) return;
    client.status = status;
    notifyListeners();
  }

  // -------------------------------------------------------------------------
  // Fee Policies
  // -------------------------------------------------------------------------
  void toggleFeePolicyEnabled(String policyId) {
    final policy = feePolicyById(policyId);
    if (policy == null) return;
    policy.enabled = !policy.enabled;
    policy.updatedAt = DateTime.now();
    notifyListeners();
  }

  void updateFeeAmounts(
    String policyId, {
    double? documentationAmount,
    double? permitAmount,
    double? visaAmount,
  }) {
    final policy = feePolicyById(policyId);
    if (policy == null) return;
    policy.documentationAmount = documentationAmount;
    policy.permitAmount = permitAmount;
    policy.visaAmount = visaAmount;
    policy.updatedAt = DateTime.now();
    notifyListeners();
  }

  // -------------------------------------------------------------------------
  // Campaigns
  // -------------------------------------------------------------------------
  void createCampaign({
    required String name,
    required DateTime startDate,
    required DateTime endDate,
    String? notes,
  }) {
    campaigns.insert(
      0,
      ManagementCampaign(
        id: 'cp${DateTime.now().millisecondsSinceEpoch}',
        name: name,
        status: 'draft',
        startDate: startDate,
        endDate: endDate,
        creatorName: directorName,
        targets: [],
        notes: notes,
      ),
    );
    notifyListeners();
  }

  void updateCampaignStatus(String campaignId, String status) {
    for (final campaign in campaigns) {
      if (campaign.id == campaignId) {
        campaign.status = status;
        notifyListeners();
        return;
      }
    }
  }

  void deleteCampaign(String campaignId) {
    campaigns.removeWhere((c) => c.id == campaignId);
    notifyListeners();
  }

  void addTarget(
    String campaignId, {
    required String metric,
    required num targetValue,
    String? scope,
  }) {
    for (final campaign in campaigns) {
      if (campaign.id != campaignId) continue;
      final isRegion = scope == 'East Africa' || scope == 'Coast';
      campaign.targets.add(CampaignTarget(
        id: 't${DateTime.now().millisecondsSinceEpoch}',
        metric: metric,
        targetValue: targetValue,
        countryName: (scope != null && !isRegion) ? scope : null,
        regionName: isRegion ? scope : null,
      ));
      notifyListeners();
      return;
    }
  }

  void removeTarget(String campaignId, String targetId) {
    for (final campaign in campaigns) {
      if (campaign.id == campaignId) {
        campaign.targets.removeWhere((t) => t.id == targetId);
        notifyListeners();
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Partners
  // -------------------------------------------------------------------------
  void addPartner({
    required String name,
    required String partnerType,
    required String countryOfOperation,
    String? businessRegNumber,
    required String contactName,
    required String contactEmail,
    required String contactPhone,
  }) {
    partners.insert(
      0,
      ManagementPartner(
        id: 'pt${DateTime.now().millisecondsSinceEpoch}',
        name: name,
        partnerType: partnerType,
        countryOfOperation: countryOfOperation,
        status: 'pending',
        mouStatus: 'none',
        contactName: contactName,
        contactEmail: contactEmail,
        contactPhone: contactPhone,
        businessRegNumber: businessRegNumber,
        candidatesSourcedCount: 0,
      ),
    );
    notifyListeners();
  }

  void updatePartnerDetails(
    String partnerId, {
    required String name,
    required String countryOfOperation,
    required String contactName,
    required String contactEmail,
    required String contactPhone,
    String? notes,
  }) {
    final partner = partnerById(partnerId);
    if (partner == null) return;
    partner.name = name;
    partner.countryOfOperation = countryOfOperation;
    partner.contactName = contactName;
    partner.contactEmail = contactEmail;
    partner.contactPhone = contactPhone;
    partner.notes = notes;
    notifyListeners();
  }

  void updatePartnerStatus(String partnerId, String status) {
    final partner = partnerById(partnerId);
    if (partner == null) return;
    partner.status = status;
    notifyListeners();
  }

  void updateMouStatus(String partnerId, String mouStatus) {
    final partner = partnerById(partnerId);
    if (partner == null) return;
    partner.mouStatus = mouStatus;
    notifyListeners();
  }

  void provisionLogin(String partnerId) {
    final partner = partnerById(partnerId);
    if (partner == null || partner.userId != null) return;
    partner.userId = 'u${DateTime.now().millisecondsSinceEpoch}';
    notifyListeners();
  }

  void deletePartner(String partnerId) {
    partners.removeWhere((p) => p.id == partnerId);
    _partnerCandidates.remove(partnerId);
    notifyListeners();
  }
}