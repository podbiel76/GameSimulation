"""
Tactical hierarchy and geometry constants.
"""

UNIT_HIERARCHY_ORDER = [
    "Region_Theater",
    "Army_Group_Front",
    "Army",
    "Corps_MEF",
    "Division",
    "Brigade",
    "Regiment_Group",
    "Battalion_Squadron",
    "Company_Battery_Troop",
    "Platoon_Detachment",
    "Section",
    "Squad",
    "Team_Crew",
]

UNIT_CHILDREN = {
    "Region_Theater": "Army_Group_Front",
    "Army_Group_Front": "Army",
    "Army": "Corps_MEF",
    "Corps_MEF": "Division",
    "Division": "Brigade",
    "Brigade": "Regiment_Group",
    "Regiment_Group": "Battalion_Squadron",
    "Battalion_Squadron": "Company_Battery_Troop",
    "Company_Battery_Troop": "Platoon_Detachment",
    "Platoon_Detachment": "Section",
    "Section": "Squad",
    "Squad": "Team_Crew",
    "Team_Crew": None,
}

def get_area_size_for_echelon(echelon: str) -> float:
    """Returns area side length in km for a given echelon."""
    sizes = {
        "team_crew": 0.1,
        "squad": 0.2,
        "section": 0.4,
        "platoon_detachment": 0.8,
        "company_battery_troop": 1.6,
        "battalion_squadron": 3.2,
        "regiment_group": 6.4,
        "brigade": 12.8,
        "division": 25.6,
        "corps_mef": 51.2,
        "army": 102.4,
        "army_group_front": 204.8,
        "region_theater": 409.6,
    }
    return sizes.get(echelon.lower(), 5.0)
