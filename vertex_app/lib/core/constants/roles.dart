enum VertexRole {
  regionalRecruiter, countrySupervisor, inhouseSupervisor, director,
  admin, marketing, partner, hr, operationsTeam, operationsDirector, finance;

  /// The role for a server value, or null for one this app has no screens for
  /// (candidate, referral_agent). Never a default: an unknown role must not
  /// open anyone's screens.
  static VertexRole? tryFromWire(String value) {
    for (final role in VertexRole.values) {
      if (role.toWire() == value) return role;
    }
    return null;
  }

  String toWire() => switch (this) {
    VertexRole.regionalRecruiter => 'regional_recruiter', VertexRole.countrySupervisor => 'country_supervisor',
    VertexRole.inhouseSupervisor => 'inhouse_supervisor', VertexRole.director => 'director', VertexRole.admin => 'admin', VertexRole.marketing => 'marketing',
    VertexRole.partner => 'partner', VertexRole.hr => 'hr', VertexRole.operationsTeam => 'operations_team', VertexRole.operationsDirector => 'operations_director', VertexRole.finance => 'finance',
  };

  String get portalHome => switch (this) {
    VertexRole.regionalRecruiter => '/recruiter', VertexRole.countrySupervisor => '/supervisor',
    VertexRole.inhouseSupervisor => '/inhouse', VertexRole.director => '/management', VertexRole.admin => '/admin', VertexRole.marketing => '/marketing',
    VertexRole.partner => '/partner', VertexRole.hr => '/hr', VertexRole.operationsTeam || VertexRole.operationsDirector => '/operations', VertexRole.finance => '/finance',
  };

  String get displayLabel => switch (this) {
    VertexRole.regionalRecruiter => 'Regional Recruiter', VertexRole.countrySupervisor => 'Country Supervisor',
    VertexRole.inhouseSupervisor => 'In-House Supervisor', VertexRole.director => 'Director', VertexRole.admin => 'Administrator', VertexRole.marketing => 'Marketing',
    VertexRole.partner => 'Partner', VertexRole.hr => 'HR', VertexRole.operationsTeam => 'Operations', VertexRole.operationsDirector => 'Operations Director', VertexRole.finance => 'Finance',
  };

  bool get isStaff => this != VertexRole.partner && this != VertexRole.marketing;
}