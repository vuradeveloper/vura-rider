import { i as createServerFn } from "./esm-Dova13aH.js";
import { i as setUser, n as PhoneShell } from "./PhoneShell-BHLURtmB.js";
import { t as createSsrRpc } from "./createSsrRpc-Bb57tAE3.js";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
//#region src/lib/countries.ts
var countries = [
	{
		name: "Afghanistan",
		code: "AF",
		dial_code: "+93",
		flag: "🇦🇫"
	},
	{
		name: "Aland Islands",
		code: "AX",
		dial_code: "+358",
		flag: "🇦🇽"
	},
	{
		name: "Albania",
		code: "AL",
		dial_code: "+355",
		flag: "🇦🇱"
	},
	{
		name: "Algeria",
		code: "DZ",
		dial_code: "+213",
		flag: "🇩🇿"
	},
	{
		name: "AmericanSamoa",
		code: "AS",
		dial_code: "+1684",
		flag: "🇦🇸"
	},
	{
		name: "Andorra",
		code: "AD",
		dial_code: "+376",
		flag: "🇦🇩"
	},
	{
		name: "Angola",
		code: "AO",
		dial_code: "+244",
		flag: "🇦🇴"
	},
	{
		name: "Anguilla",
		code: "AI",
		dial_code: "+1264",
		flag: "🇦🇮"
	},
	{
		name: "Antarctica",
		code: "AQ",
		dial_code: "+672",
		flag: "🇦🇶"
	},
	{
		name: "Antigua and Barbuda",
		code: "AG",
		dial_code: "+1268",
		flag: "🇦🇬"
	},
	{
		name: "Argentina",
		code: "AR",
		dial_code: "+54",
		flag: "🇦🇷"
	},
	{
		name: "Armenia",
		code: "AM",
		dial_code: "+374",
		flag: "🇦🇲"
	},
	{
		name: "Aruba",
		code: "AW",
		dial_code: "+297",
		flag: "🇦🇼"
	},
	{
		name: "Australia",
		code: "AU",
		dial_code: "+61",
		flag: "🇦🇺"
	},
	{
		name: "Austria",
		code: "AT",
		dial_code: "+43",
		flag: "🇦🇹"
	},
	{
		name: "Azerbaijan",
		code: "AZ",
		dial_code: "+994",
		flag: "🇦🇿"
	},
	{
		name: "Bahamas",
		code: "BS",
		dial_code: "+1242",
		flag: "🇧🇸"
	},
	{
		name: "Bahrain",
		code: "BH",
		dial_code: "+973",
		flag: "🇧🇭"
	},
	{
		name: "Bangladesh",
		code: "BD",
		dial_code: "+880",
		flag: "🇧🇩"
	},
	{
		name: "Barbados",
		code: "BB",
		dial_code: "+1246",
		flag: "🇧🇧"
	},
	{
		name: "Belarus",
		code: "BY",
		dial_code: "+375",
		flag: "🇧🇾"
	},
	{
		name: "Belgium",
		code: "BE",
		dial_code: "+32",
		flag: "🇧🇪"
	},
	{
		name: "Belize",
		code: "BZ",
		dial_code: "+501",
		flag: "🇧🇿"
	},
	{
		name: "Benin",
		code: "BJ",
		dial_code: "+229",
		flag: "🇧🇯"
	},
	{
		name: "Bermuda",
		code: "BM",
		dial_code: "+1441",
		flag: "🇧🇲"
	},
	{
		name: "Bhutan",
		code: "BT",
		dial_code: "+975",
		flag: "🇧🇹"
	},
	{
		name: "Bolivia, Plurinational State of",
		code: "BO",
		dial_code: "+591",
		flag: "🇧🇴"
	},
	{
		name: "Bosnia and Herzegovina",
		code: "BA",
		dial_code: "+387",
		flag: "🇧🇦"
	},
	{
		name: "Botswana",
		code: "BW",
		dial_code: "+267",
		flag: "🇧🇼"
	},
	{
		name: "Brazil",
		code: "BR",
		dial_code: "+55",
		flag: "🇧🇷"
	},
	{
		name: "British Indian Ocean Territory",
		code: "IO",
		dial_code: "+246",
		flag: "🇮🇴"
	},
	{
		name: "Brunei Darussalam",
		code: "BN",
		dial_code: "+673",
		flag: "🇧🇳"
	},
	{
		name: "Bulgaria",
		code: "BG",
		dial_code: "+359",
		flag: "🇧🇬"
	},
	{
		name: "Burkina Faso",
		code: "BF",
		dial_code: "+226",
		flag: "🇧🇫"
	},
	{
		name: "Burundi",
		code: "BI",
		dial_code: "+257",
		flag: "🇧🇮"
	},
	{
		name: "Cambodia",
		code: "KH",
		dial_code: "+855",
		flag: "🇰🇭"
	},
	{
		name: "Cameroon",
		code: "CM",
		dial_code: "+237",
		flag: "🇨🇲"
	},
	{
		name: "Canada",
		code: "CA",
		dial_code: "+1",
		flag: "🇨🇦"
	},
	{
		name: "Cape Verde",
		code: "CV",
		dial_code: "+238",
		flag: "🇨🇻"
	},
	{
		name: "Cayman Islands",
		code: "KY",
		dial_code: "+ 345",
		flag: "🇰🇾"
	},
	{
		name: "Central African Republic",
		code: "CF",
		dial_code: "+236",
		flag: "🇨🇫"
	},
	{
		name: "Chad",
		code: "TD",
		dial_code: "+235",
		flag: "🇹🇩"
	},
	{
		name: "Chile",
		code: "CL",
		dial_code: "+56",
		flag: "🇨🇱"
	},
	{
		name: "China",
		code: "CN",
		dial_code: "+86",
		flag: "🇨🇳"
	},
	{
		name: "Christmas Island",
		code: "CX",
		dial_code: "+61",
		flag: "🇨🇽"
	},
	{
		name: "Cocos (Keeling) Islands",
		code: "CC",
		dial_code: "+61",
		flag: "🇨🇨"
	},
	{
		name: "Colombia",
		code: "CO",
		dial_code: "+57",
		flag: "🇨🇴"
	},
	{
		name: "Comoros",
		code: "KM",
		dial_code: "+269",
		flag: "🇰🇲"
	},
	{
		name: "Congo",
		code: "CG",
		dial_code: "+242",
		flag: "🇨🇬"
	},
	{
		name: "Congo, The Democratic Republic of the Congo",
		code: "CD",
		dial_code: "+243",
		flag: "🇨🇩"
	},
	{
		name: "Cook Islands",
		code: "CK",
		dial_code: "+682",
		flag: "🇨🇰"
	},
	{
		name: "Costa Rica",
		code: "CR",
		dial_code: "+506",
		flag: "🇨🇷"
	},
	{
		name: "Cote d'Ivoire",
		code: "CI",
		dial_code: "+225",
		flag: "🇨🇮"
	},
	{
		name: "Croatia",
		code: "HR",
		dial_code: "+385",
		flag: "🇭🇷"
	},
	{
		name: "Cuba",
		code: "CU",
		dial_code: "+53",
		flag: "🇨🇺"
	},
	{
		name: "Cyprus",
		code: "CY",
		dial_code: "+357",
		flag: "🇨🇾"
	},
	{
		name: "Czech Republic",
		code: "CZ",
		dial_code: "+420",
		flag: "🇨🇿"
	},
	{
		name: "Denmark",
		code: "DK",
		dial_code: "+45",
		flag: "🇩🇰"
	},
	{
		name: "Djibouti",
		code: "DJ",
		dial_code: "+253",
		flag: "🇩🇯"
	},
	{
		name: "Dominica",
		code: "DM",
		dial_code: "+1767",
		flag: "🇩🇲"
	},
	{
		name: "Dominican Republic",
		code: "DO",
		dial_code: "+1849",
		flag: "🇩🇴"
	},
	{
		name: "Ecuador",
		code: "EC",
		dial_code: "+593",
		flag: "🇪🇨"
	},
	{
		name: "Egypt",
		code: "EG",
		dial_code: "+20",
		flag: "🇪🇬"
	},
	{
		name: "El Salvador",
		code: "SV",
		dial_code: "+503",
		flag: "🇸🇻"
	},
	{
		name: "Equatorial Guinea",
		code: "GQ",
		dial_code: "+240",
		flag: "🇬🇶"
	},
	{
		name: "Eritrea",
		code: "ER",
		dial_code: "+291",
		flag: "🇪🇷"
	},
	{
		name: "Estonia",
		code: "EE",
		dial_code: "+372",
		flag: "🇪🇪"
	},
	{
		name: "Ethiopia",
		code: "ET",
		dial_code: "+251",
		flag: "🇪🇹"
	},
	{
		name: "Falkland Islands (Malvinas)",
		code: "FK",
		dial_code: "+500",
		flag: "🇫🇰"
	},
	{
		name: "Faroe Islands",
		code: "FO",
		dial_code: "+298",
		flag: "🇫🇴"
	},
	{
		name: "Fiji",
		code: "FJ",
		dial_code: "+679",
		flag: "🇫🇯"
	},
	{
		name: "Finland",
		code: "FI",
		dial_code: "+358",
		flag: "🇫🇮"
	},
	{
		name: "France",
		code: "FR",
		dial_code: "+33",
		flag: "🇫🇷"
	},
	{
		name: "French Guiana",
		code: "GF",
		dial_code: "+594",
		flag: "🇬🇫"
	},
	{
		name: "French Polynesia",
		code: "PF",
		dial_code: "+689",
		flag: "🇵🇫"
	},
	{
		name: "Gabon",
		code: "GA",
		dial_code: "+241",
		flag: "🇬🇦"
	},
	{
		name: "Gambia",
		code: "GM",
		dial_code: "+220",
		flag: "🇬🇲"
	},
	{
		name: "Georgia",
		code: "GE",
		dial_code: "+995",
		flag: "🇬🇪"
	},
	{
		name: "Germany",
		code: "DE",
		dial_code: "+49",
		flag: "🇩🇪"
	},
	{
		name: "Ghana",
		code: "GH",
		dial_code: "+233",
		flag: "🇬🇭"
	},
	{
		name: "Gibraltar",
		code: "GI",
		dial_code: "+350",
		flag: "🇬🇮"
	},
	{
		name: "Greece",
		code: "GR",
		dial_code: "+30",
		flag: "🇬🇷"
	},
	{
		name: "Greenland",
		code: "GL",
		dial_code: "+299",
		flag: "🇬🇱"
	},
	{
		name: "Grenada",
		code: "GD",
		dial_code: "+1473",
		flag: "🇬🇩"
	},
	{
		name: "Guadeloupe",
		code: "GP",
		dial_code: "+590",
		flag: "🇬🇵"
	},
	{
		name: "Guam",
		code: "GU",
		dial_code: "+1671",
		flag: "🇬🇺"
	},
	{
		name: "Guatemala",
		code: "GT",
		dial_code: "+502",
		flag: "🇬🇹"
	},
	{
		name: "Guernsey",
		code: "GG",
		dial_code: "+44",
		flag: "🇬🇬"
	},
	{
		name: "Guinea",
		code: "GN",
		dial_code: "+224",
		flag: "🇬🇳"
	},
	{
		name: "Guinea-Bissau",
		code: "GW",
		dial_code: "+245",
		flag: "🇬🇼"
	},
	{
		name: "Guyana",
		code: "GY",
		dial_code: "+595",
		flag: "🇬🇾"
	},
	{
		name: "Haiti",
		code: "HT",
		dial_code: "+509",
		flag: "🇭🇹"
	},
	{
		name: "Holy See (Vatican City State)",
		code: "VA",
		dial_code: "+379",
		flag: "🇻🇦"
	},
	{
		name: "Honduras",
		code: "HN",
		dial_code: "+504",
		flag: "🇭🇳"
	},
	{
		name: "Hong Kong",
		code: "HK",
		dial_code: "+852",
		flag: "🇭🇰"
	},
	{
		name: "Hungary",
		code: "HU",
		dial_code: "+36",
		flag: "🇭🇺"
	},
	{
		name: "Iceland",
		code: "IS",
		dial_code: "+354",
		flag: "🇮🇸"
	},
	{
		name: "India",
		code: "IN",
		dial_code: "+91",
		flag: "🇮🇳"
	},
	{
		name: "Indonesia",
		code: "ID",
		dial_code: "+62",
		flag: "🇮🇩"
	},
	{
		name: "Iran, Islamic Republic of Persian Gulf",
		code: "IR",
		dial_code: "+98",
		flag: "🇮🇷"
	},
	{
		name: "Iraq",
		code: "IQ",
		dial_code: "+964",
		flag: "🇮🇶"
	},
	{
		name: "Ireland",
		code: "IE",
		dial_code: "+353",
		flag: "🇮🇪"
	},
	{
		name: "Isle of Man",
		code: "IM",
		dial_code: "+44",
		flag: "🇮🇲"
	},
	{
		name: "Israel",
		code: "IL",
		dial_code: "+972",
		flag: "🇮🇱"
	},
	{
		name: "Italy",
		code: "IT",
		dial_code: "+39",
		flag: "🇮🇹"
	},
	{
		name: "Jamaica",
		code: "JM",
		dial_code: "+1876",
		flag: "🇯🇲"
	},
	{
		name: "Japan",
		code: "JP",
		dial_code: "+81",
		flag: "🇯🇵"
	},
	{
		name: "Jersey",
		code: "JE",
		dial_code: "+44",
		flag: "🇯🇪"
	},
	{
		name: "Jordan",
		code: "JO",
		dial_code: "+962",
		flag: "🇯🇴"
	},
	{
		name: "Kazakhstan",
		code: "KZ",
		dial_code: "+77",
		flag: "🇰🇿"
	},
	{
		name: "Kenya",
		code: "KE",
		dial_code: "+254",
		flag: "🇰🇪"
	},
	{
		name: "Kiribati",
		code: "KI",
		dial_code: "+686",
		flag: "🇰🇮"
	},
	{
		name: "Korea, Democratic People's Republic of Korea",
		code: "KP",
		dial_code: "+850",
		flag: "🇰🇵"
	},
	{
		name: "Korea, Republic of South Korea",
		code: "KR",
		dial_code: "+82",
		flag: "🇰🇷"
	},
	{
		name: "Kuwait",
		code: "KW",
		dial_code: "+965",
		flag: "🇰🇼"
	},
	{
		name: "Kyrgyzstan",
		code: "KG",
		dial_code: "+996",
		flag: "🇰🇬"
	},
	{
		name: "Laos",
		code: "LA",
		dial_code: "+856",
		flag: "🇱🇦"
	},
	{
		name: "Latvia",
		code: "LV",
		dial_code: "+371",
		flag: "🇱🇻"
	},
	{
		name: "Lebanon",
		code: "LB",
		dial_code: "+961",
		flag: "🇱🇧"
	},
	{
		name: "Lesotho",
		code: "LS",
		dial_code: "+266",
		flag: "🇱🇸"
	},
	{
		name: "Liberia",
		code: "LR",
		dial_code: "+231",
		flag: "🇱🇷"
	},
	{
		name: "Libyan Arab Jamahiriya",
		code: "LY",
		dial_code: "+218",
		flag: "🇱🇾"
	},
	{
		name: "Liechtenstein",
		code: "LI",
		dial_code: "+423",
		flag: "🇱🇮"
	},
	{
		name: "Lithuania",
		code: "LT",
		dial_code: "+370",
		flag: "🇱🇹"
	},
	{
		name: "Luxembourg",
		code: "LU",
		dial_code: "+352",
		flag: "🇱🇺"
	},
	{
		name: "Macao",
		code: "MO",
		dial_code: "+853",
		flag: "🇲🇴"
	},
	{
		name: "Macedonia",
		code: "MK",
		dial_code: "+389",
		flag: "🇲🇰"
	},
	{
		name: "Madagascar",
		code: "MG",
		dial_code: "+261",
		flag: "🇲🇬"
	},
	{
		name: "Malawi",
		code: "MW",
		dial_code: "+265",
		flag: "🇲🇼"
	},
	{
		name: "Malaysia",
		code: "MY",
		dial_code: "+60",
		flag: "🇲🇾"
	},
	{
		name: "Maldives",
		code: "MV",
		dial_code: "+960",
		flag: "🇲🇻"
	},
	{
		name: "Mali",
		code: "ML",
		dial_code: "+223",
		flag: "🇲🇱"
	},
	{
		name: "Malta",
		code: "MT",
		dial_code: "+356",
		flag: "🇲🇹"
	},
	{
		name: "Marshall Islands",
		code: "MH",
		dial_code: "+692",
		flag: "🇲🇭"
	},
	{
		name: "Martinique",
		code: "MQ",
		dial_code: "+596",
		flag: "🇲🇶"
	},
	{
		name: "Mauritania",
		code: "MR",
		dial_code: "+222",
		flag: "🇲🇷"
	},
	{
		name: "Mauritius",
		code: "MU",
		dial_code: "+230",
		flag: "🇲🇺"
	},
	{
		name: "Mayotte",
		code: "YT",
		dial_code: "+262",
		flag: "🇾🇹"
	},
	{
		name: "Mexico",
		code: "MX",
		dial_code: "+52",
		flag: "🇲🇽"
	},
	{
		name: "Micronesia, Federated States of Micronesia",
		code: "FM",
		dial_code: "+691",
		flag: "🇫🇲"
	},
	{
		name: "Moldova",
		code: "MD",
		dial_code: "+373",
		flag: "🇲🇩"
	},
	{
		name: "Monaco",
		code: "MC",
		dial_code: "+377",
		flag: "🇲🇨"
	},
	{
		name: "Mongolia",
		code: "MN",
		dial_code: "+976",
		flag: "🇲🇳"
	},
	{
		name: "Montenegro",
		code: "ME",
		dial_code: "+382",
		flag: "🇲🇪"
	},
	{
		name: "Montserrat",
		code: "MS",
		dial_code: "+1664",
		flag: "🇲🇸"
	},
	{
		name: "Morocco",
		code: "MA",
		dial_code: "+212",
		flag: "🇲🇦"
	},
	{
		name: "Mozambique",
		code: "MZ",
		dial_code: "+258",
		flag: "🇲🇿"
	},
	{
		name: "Myanmar",
		code: "MM",
		dial_code: "+95",
		flag: "🇲🇲"
	},
	{
		name: "Namibia",
		code: "NA",
		dial_code: "+264",
		flag: "🇳🇦"
	},
	{
		name: "Nauru",
		code: "NR",
		dial_code: "+674",
		flag: "🇳🇷"
	},
	{
		name: "Nepal",
		code: "NP",
		dial_code: "+977",
		flag: "🇳🇵"
	},
	{
		name: "Netherlands",
		code: "NL",
		dial_code: "+31",
		flag: "🇳🇱"
	},
	{
		name: "Netherlands Antilles",
		code: "AN",
		dial_code: "+599",
		flag: "🇦🇳"
	},
	{
		name: "New Caledonia",
		code: "NC",
		dial_code: "+687",
		flag: "🇳🇨"
	},
	{
		name: "New Zealand",
		code: "NZ",
		dial_code: "+64",
		flag: "🇳🇿"
	},
	{
		name: "Nicaragua",
		code: "NI",
		dial_code: "+505",
		flag: "🇳🇮"
	},
	{
		name: "Niger",
		code: "NE",
		dial_code: "+227",
		flag: "🇳🇪"
	},
	{
		name: "Nigeria",
		code: "NG",
		dial_code: "+234",
		flag: "🇳🇬"
	},
	{
		name: "Niue",
		code: "NU",
		dial_code: "+683",
		flag: "🇳🇺"
	},
	{
		name: "Norfolk Island",
		code: "NF",
		dial_code: "+672",
		flag: "🇳🇫"
	},
	{
		name: "Northern Mariana Islands",
		code: "MP",
		dial_code: "+1670",
		flag: "🇲🇵"
	},
	{
		name: "Norway",
		code: "NO",
		dial_code: "+47",
		flag: "🇳🇴"
	},
	{
		name: "Oman",
		code: "OM",
		dial_code: "+968",
		flag: "🇴🇲"
	},
	{
		name: "Pakistan",
		code: "PK",
		dial_code: "+92",
		flag: "🇵🇰"
	},
	{
		name: "Palau",
		code: "PW",
		dial_code: "+680",
		flag: "🇵🇼"
	},
	{
		name: "Palestinian Territory, Occupied",
		code: "PS",
		dial_code: "+970",
		flag: "🇵🇸"
	},
	{
		name: "Panama",
		code: "PA",
		dial_code: "+507",
		flag: "🇵🇦"
	},
	{
		name: "Papua New Guinea",
		code: "PG",
		dial_code: "+675",
		flag: "🇵🇬"
	},
	{
		name: "Paraguay",
		code: "PY",
		dial_code: "+595",
		flag: "🇵🇾"
	},
	{
		name: "Peru",
		code: "PE",
		dial_code: "+51",
		flag: "🇵🇪"
	},
	{
		name: "Philippines",
		code: "PH",
		dial_code: "+63",
		flag: "🇵🇭"
	},
	{
		name: "Pitcairn",
		code: "PN",
		dial_code: "+872",
		flag: "🇵🇳"
	},
	{
		name: "Poland",
		code: "PL",
		dial_code: "+48",
		flag: "🇵🇱"
	},
	{
		name: "Portugal",
		code: "PT",
		dial_code: "+351",
		flag: "🇵🇹"
	},
	{
		name: "Puerto Rico",
		code: "PR",
		dial_code: "+1939",
		flag: "🇵🇷"
	},
	{
		name: "Qatar",
		code: "QA",
		dial_code: "+974",
		flag: "🇶🇦"
	},
	{
		name: "Romania",
		code: "RO",
		dial_code: "+40",
		flag: "🇷🇴"
	},
	{
		name: "Russia",
		code: "RU",
		dial_code: "+7",
		flag: "🇷🇺"
	},
	{
		name: "Rwanda",
		code: "RW",
		dial_code: "+250",
		flag: "🇷🇼"
	},
	{
		name: "Reunion",
		code: "RE",
		dial_code: "+262",
		flag: "🇷🇪"
	},
	{
		name: "Saint Barthelemy",
		code: "BL",
		dial_code: "+590",
		flag: "🇧🇱"
	},
	{
		name: "Saint Helena, Ascension and Tristan Da Cunha",
		code: "SH",
		dial_code: "+290",
		flag: "🇸🇭"
	},
	{
		name: "Saint Kitts and Nevis",
		code: "KN",
		dial_code: "+1869",
		flag: "🇰🇳"
	},
	{
		name: "Saint Lucia",
		code: "LC",
		dial_code: "+1758",
		flag: "🇱🇨"
	},
	{
		name: "Saint Martin",
		code: "MF",
		dial_code: "+590",
		flag: "🇲🇫"
	},
	{
		name: "Saint Pierre and Miquelon",
		code: "PM",
		dial_code: "+508",
		flag: "🇵🇲"
	},
	{
		name: "Saint Vincent and the Grenadines",
		code: "VC",
		dial_code: "+1784",
		flag: "🇻🇨"
	},
	{
		name: "Samoa",
		code: "WS",
		dial_code: "+685",
		flag: "🇼🇸"
	},
	{
		name: "San Marino",
		code: "SM",
		dial_code: "+378",
		flag: "🇸🇲"
	},
	{
		name: "Sao Tome and Principe",
		code: "ST",
		dial_code: "+239",
		flag: "🇸🇹"
	},
	{
		name: "Saudi Arabia",
		code: "SA",
		dial_code: "+966",
		flag: "🇸🇦"
	},
	{
		name: "Senegal",
		code: "SN",
		dial_code: "+221",
		flag: "🇸🇳"
	},
	{
		name: "Serbia",
		code: "RS",
		dial_code: "+381",
		flag: "🇷🇸"
	},
	{
		name: "Seychelles",
		code: "SC",
		dial_code: "+248",
		flag: "🇸🇨"
	},
	{
		name: "Sierra Leone",
		code: "SL",
		dial_code: "+232",
		flag: "🇸🇱"
	},
	{
		name: "Singapore",
		code: "SG",
		dial_code: "+65",
		flag: "🇸🇬"
	},
	{
		name: "Slovakia",
		code: "SK",
		dial_code: "+421",
		flag: "🇸🇰"
	},
	{
		name: "Slovenia",
		code: "SI",
		dial_code: "+386",
		flag: "🇸🇮"
	},
	{
		name: "Solomon Islands",
		code: "SB",
		dial_code: "+677",
		flag: "🇸🇧"
	},
	{
		name: "Somalia",
		code: "SO",
		dial_code: "+252",
		flag: "🇸🇴"
	},
	{
		name: "South Africa",
		code: "ZA",
		dial_code: "+27",
		flag: "🇿🇦"
	},
	{
		name: "South Sudan",
		code: "SS",
		dial_code: "+211",
		flag: "🇸🇸"
	},
	{
		name: "South Georgia and the South Sandwich Islands",
		code: "GS",
		dial_code: "+500",
		flag: "🇬🇸"
	},
	{
		name: "Spain",
		code: "ES",
		dial_code: "+34",
		flag: "🇪🇸"
	},
	{
		name: "Sri Lanka",
		code: "LK",
		dial_code: "+94",
		flag: "🇱🇰"
	},
	{
		name: "Sudan",
		code: "SD",
		dial_code: "+249",
		flag: "🇸🇩"
	},
	{
		name: "Suriname",
		code: "SR",
		dial_code: "+597",
		flag: "🇸🇷"
	},
	{
		name: "Svalbard and Jan Mayen",
		code: "SJ",
		dial_code: "+47",
		flag: "🇸🇯"
	},
	{
		name: "Swaziland",
		code: "SZ",
		dial_code: "+268",
		flag: "🇸🇿"
	},
	{
		name: "Sweden",
		code: "SE",
		dial_code: "+46",
		flag: "🇸🇪"
	},
	{
		name: "Switzerland",
		code: "CH",
		dial_code: "+41",
		flag: "🇨🇭"
	},
	{
		name: "Syrian Arab Republic",
		code: "SY",
		dial_code: "+963",
		flag: "🇸🇾"
	},
	{
		name: "Taiwan",
		code: "TW",
		dial_code: "+886",
		flag: "🇹🇼"
	},
	{
		name: "Tajikistan",
		code: "TJ",
		dial_code: "+992",
		flag: "🇹🇯"
	},
	{
		name: "Tanzania, United Republic of Tanzania",
		code: "TZ",
		dial_code: "+255",
		flag: "🇹🇿"
	},
	{
		name: "Thailand",
		code: "TH",
		dial_code: "+66",
		flag: "🇹🇭"
	},
	{
		name: "Timor-Leste",
		code: "TL",
		dial_code: "+670",
		flag: "🇹🇱"
	},
	{
		name: "Togo",
		code: "TG",
		dial_code: "+228",
		flag: "🇹🇬"
	},
	{
		name: "Tokelau",
		code: "TK",
		dial_code: "+690",
		flag: "🇹🇰"
	},
	{
		name: "Tonga",
		code: "TO",
		dial_code: "+676",
		flag: "🇹🇴"
	},
	{
		name: "Trinidad and Tobago",
		code: "TT",
		dial_code: "+1868",
		flag: "🇹🇹"
	},
	{
		name: "Tunisia",
		code: "TN",
		dial_code: "+216",
		flag: "🇹🇳"
	},
	{
		name: "Turkey",
		code: "TR",
		dial_code: "+90",
		flag: "🇹🇷"
	},
	{
		name: "Turkmenistan",
		code: "TM",
		dial_code: "+993",
		flag: "🇹🇲"
	},
	{
		name: "Turks and Caicos Islands",
		code: "TC",
		dial_code: "+1649",
		flag: "🇹🇨"
	},
	{
		name: "Tuvalu",
		code: "TV",
		dial_code: "+688",
		flag: "🇹🇻"
	},
	{
		name: "Uganda",
		code: "UG",
		dial_code: "+256",
		flag: "🇺🇬"
	},
	{
		name: "Ukraine",
		code: "UA",
		dial_code: "+380",
		flag: "🇺🇦"
	},
	{
		name: "United Arab Emirates",
		code: "AE",
		dial_code: "+971",
		flag: "🇦🇪"
	},
	{
		name: "United Kingdom",
		code: "GB",
		dial_code: "+44",
		flag: "🇬🇧"
	},
	{
		name: "United States",
		code: "US",
		dial_code: "+1",
		flag: "🇺🇸"
	},
	{
		name: "Uruguay",
		code: "UY",
		dial_code: "+598",
		flag: "🇺🇾"
	},
	{
		name: "Uzbekistan",
		code: "UZ",
		dial_code: "+998",
		flag: "🇺🇿"
	},
	{
		name: "Vanuatu",
		code: "VU",
		dial_code: "+678",
		flag: "🇻🇺"
	},
	{
		name: "Venezuela, Bolivarian Republic of Venezuela",
		code: "VE",
		dial_code: "+58",
		flag: "🇻🇪"
	},
	{
		name: "Vietnam",
		code: "VN",
		dial_code: "+84",
		flag: "🇻🇳"
	},
	{
		name: "Virgin Islands, British",
		code: "VG",
		dial_code: "+1284",
		flag: "🇻🇬"
	},
	{
		name: "Virgin Islands, U.S.",
		code: "VI",
		dial_code: "+1340",
		flag: "🇻🇮"
	},
	{
		name: "Wallis and Futuna",
		code: "WF",
		dial_code: "+681",
		flag: "🇼🇫"
	},
	{
		name: "Yemen",
		code: "YE",
		dial_code: "+967",
		flag: "🇾🇪"
	},
	{
		name: "Zambia",
		code: "ZM",
		dial_code: "+260",
		flag: "🇿🇲"
	},
	{
		name: "Zimbabwe",
		code: "ZW",
		dial_code: "+263",
		flag: "🇿🇼"
	}
];
//#endregion
//#region src/lib/email.ts
/**
* Server Function to send verification email securely via Resend API on the backend.
* Bypasses CORS and keeps the API key hidden from the client browser.
*/
var sendVerificationEmail = createServerFn({ method: "POST" }).validator((data) => data).handler(createSsrRpc("bca51df22d8a6c730017c7cb2bde4f7305bbdd712ae27a692c6015c21629e22c"));
//#endregion
//#region src/routes/signup.tsx?tsr-split=component
function Signup() {
	const nav = useNavigate();
	const role = "rider";
	const [step, setStep] = useState(1);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [countryCode, setCountryCode] = useState("+44");
	const [phone, setPhone] = useState("");
	const [pwd, setPwd] = useState("");
	const [sendingEmail, setSendingEmail] = useState(false);
	const [generatedCode, setGeneratedCode] = useState("");
	const [otp, setOtp] = useState("");
	const [otpError, setOtpError] = useState("");
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [dob, setDob] = useState("");
	const [idNumber, setIdNumber] = useState("");
	useEffect(() => {
		if (step === 2) {
			const container = document.getElementById("recaptcha-container");
			if (container) container.innerHTML = "";
			const scriptId = "google-recaptcha-script";
			let script = document.getElementById(scriptId);
			const renderRecaptcha = () => {
				if (window.grecaptcha && document.getElementById("recaptcha-container")) try {
					window.grecaptcha.render("recaptcha-container", {
						sitekey: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
						callback: (token) => {
							toast.success("Robot check passed!");
							setTimeout(() => {
								triggerEmailSend();
							}, 1e3);
						}
					});
				} catch (e) {
					console.error("Error rendering reCAPTCHA:", e);
				}
			};
			if (window.grecaptcha) renderRecaptcha();
			else {
				if (!script) {
					script = document.createElement("script");
					script.id = scriptId;
					script.src = "https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit";
					script.async = true;
					script.defer = true;
					document.body.appendChild(script);
				}
				window.onRecaptchaLoad = () => {
					renderRecaptcha();
				};
			}
		}
	}, [step]);
	function submitDetails(e) {
		e.preventDefault();
		setStep(2);
	}
	async function triggerEmailSend() {
		setSendingEmail(true);
		setOtpError("");
		const code = Math.floor(1e5 + Math.random() * 9e5).toString();
		setGeneratedCode(code);
		try {
			const res = await sendVerificationEmail({ data: {
				email,
				code
			} });
			if (res.success) {
				toast.success("Verification code sent to your email!");
				setStep(3);
			} else {
				toast.error(res.error || "Failed to send verification email. Please check configuration.");
				setStep(1);
			}
		} catch (err) {
			toast.error(err?.message || "Failed to send verification email due to server error.");
			setStep(1);
		} finally {
			setSendingEmail(false);
		}
	}
	function submitOtp(e) {
		e.preventDefault();
		if (otp === generatedCode) {
			toast.success("Email verified!");
			setStep(4);
		} else {
			setOtpError("Invalid verification code. Please try again.");
			toast.error("Invalid verification code");
		}
	}
	function submitPersonalInfo(e) {
		e.preventDefault();
		setUser({
			name: `${firstName} ${lastName}`,
			email,
			phone: `${countryCode} ${phone}`,
			role,
			idNumber
		});
		toast.success("Account created successfully!");
		nav({ to: "/" });
	}
	return /* @__PURE__ */ jsxs(PhoneShell, {
		hideTabs: true,
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "px-5 pt-3 pb-3 flex items-center justify-between border-b border-border bg-background",
				children: [
					/* @__PURE__ */ jsx(Link, {
						to: step <= 1 ? "/welcome" : void 0,
						onClick: step > 1 ? () => setStep((s) => s - 1) : void 0,
						className: "grid place-items-center h-9 w-9 rounded-full bg-secondary cursor-pointer",
						children: /* @__PURE__ */ jsx(ArrowLeft, { className: "h-4 w-4 text-foreground/80" })
					}),
					/* @__PURE__ */ jsx("span", {
						className: "text-sm font-bold text-foreground",
						children: "Create account"
					}),
					/* @__PURE__ */ jsx("div", { className: "w-9 h-9" })
				]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "flex gap-2 px-5 py-2",
				children: [
					1,
					2,
					3,
					4
				].map((s) => /* @__PURE__ */ jsx("div", { className: `h-1 flex-1 rounded-full transition-all duration-300 ${step >= s ? "bg-primary" : "bg-secondary"}` }, s))
			}),
			step === 1 && /* @__PURE__ */ jsxs("div", {
				className: "px-5 pt-4 pb-6 flex-1 flex flex-col justify-center relative z-10",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8",
					children: [
						/* @__PURE__ */ jsx("h2", {
							className: "text-2xl font-extrabold tracking-tight",
							children: "Your details"
						}),
						/* @__PURE__ */ jsxs("p", {
							className: "text-sm text-muted-foreground mt-1 mb-5",
							children: ["Signing up as ", /* @__PURE__ */ jsx("span", {
								className: "font-bold text-primary capitalize",
								children: role
							})]
						}),
						/* @__PURE__ */ jsxs("form", {
							onSubmit: submitDetails,
							className: "space-y-4",
							children: [[
								{
									label: "Full name",
									value: name,
									set: setName,
									type: "text",
									placeholder: "Sagar Dash",
									isPhone: false
								},
								{
									label: "Email",
									value: email,
									set: setEmail,
									type: "email",
									placeholder: "you@email.com",
									isPhone: false
								},
								{
									label: "Phone",
									value: phone,
									set: setPhone,
									type: "tel",
									placeholder: "7700 900123",
									isPhone: true
								},
								{
									label: "Password",
									value: pwd,
									set: setPwd,
									type: "password",
									placeholder: "••••••••",
									isPhone: false
								}
							].map((f) => /* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [/* @__PURE__ */ jsx("span", {
									className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1",
									children: f.label
								}), f.isPhone ? /* @__PURE__ */ jsxs("div", {
									className: "mt-1 flex gap-2",
									children: [/* @__PURE__ */ jsx("select", {
										value: countryCode,
										onChange: (e) => setCountryCode(e.target.value),
										className: "w-20 rounded-lg bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-1 py-1.5 text-xs font-medium outline-none text-muted-foreground",
										children: countries.sort((a, b) => a.name.localeCompare(b.name)).map((c) => /* @__PURE__ */ jsxs("option", {
											value: c.dial_code,
											className: "text-foreground",
											children: [
												c.flag,
												" ",
												c.name,
												" ",
												c.dial_code
											]
										}, c.code))
									}), /* @__PURE__ */ jsx("input", {
										type: f.type,
										value: f.value,
										onChange: (e) => f.set(e.target.value),
										placeholder: f.placeholder,
										required: true,
										className: "flex-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
									})]
								}) : /* @__PURE__ */ jsx("input", {
									type: f.type,
									value: f.value,
									onChange: (e) => f.set(e.target.value),
									placeholder: f.placeholder,
									required: true,
									className: "mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
								})]
							}, f.label)), /* @__PURE__ */ jsx("button", {
								type: "submit",
								className: "mt-6 w-full rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition flex items-center justify-center gap-2",
								children: "Continue"
							})]
						})
					]
				}), /* @__PURE__ */ jsxs("p", {
					className: "mt-8 text-center text-sm font-medium",
					children: [
						"Already have one?",
						" ",
						/* @__PURE__ */ jsx(Link, {
							to: "/login",
							className: "font-bold text-primary hover:underline",
							children: "Sign in"
						})
					]
				})]
			}),
			step === 2 && /* @__PURE__ */ jsx("div", {
				className: "px-5 pt-4 pb-6 flex-1 flex flex-col justify-center relative z-10",
				children: /* @__PURE__ */ jsxs("div", {
					className: "bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8 text-center flex flex-col items-center",
					children: [
						/* @__PURE__ */ jsx(ShieldCheck, { className: "h-12 w-12 text-primary mb-4 animate-bounce" }),
						/* @__PURE__ */ jsx("h2", {
							className: "text-2xl font-extrabold tracking-tight",
							children: "Security Check"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-sm text-muted-foreground mt-1 mb-8",
							children: "Verify you are not a robot to receive your email code."
						}),
						/* @__PURE__ */ jsx("div", {
							className: "min-h-[78px] flex items-center justify-center",
							children: /* @__PURE__ */ jsx("div", { id: "recaptcha-container" })
						}),
						sendingEmail && /* @__PURE__ */ jsxs("div", {
							className: "mt-6 flex items-center gap-2 text-sm text-muted-foreground",
							children: [/* @__PURE__ */ jsx(Loader2, { className: "h-4 w-4 animate-spin text-primary" }), "Sending verification email..."]
						})
					]
				})
			}),
			step === 3 && /* @__PURE__ */ jsxs("div", {
				className: "px-5 pt-4 pb-6 flex-1 flex flex-col justify-center relative z-10",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8",
					children: [
						/* @__PURE__ */ jsx("h2", {
							className: "text-2xl font-extrabold tracking-tight",
							children: "Verify your email"
						}),
						/* @__PURE__ */ jsxs("p", {
							className: "text-sm text-muted-foreground mt-1 mb-5",
							children: ["We sent a verification code to ", /* @__PURE__ */ jsx("span", {
								className: "font-bold text-foreground",
								children: email
							})]
						}),
						/* @__PURE__ */ jsxs("form", {
							onSubmit: submitOtp,
							className: "space-y-4",
							children: [
								/* @__PURE__ */ jsxs("label", {
									className: "block",
									children: [/* @__PURE__ */ jsx("span", {
										className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1",
										children: "Verification Code"
									}), /* @__PURE__ */ jsx("input", {
										type: "text",
										maxLength: 6,
										value: otp,
										onChange: (e) => {
											setOtp(e.target.value.replace(/\D/g, ""));
											setOtpError("");
										},
										placeholder: "123456",
										required: true,
										className: "mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-4 text-center text-2xl font-extrabold tracking-widest outline-none"
									})]
								}),
								otpError && /* @__PURE__ */ jsx("p", {
									className: "text-xs text-red-500 font-semibold text-center mt-1",
									children: otpError
								}),
								/* @__PURE__ */ jsx("button", {
									type: "submit",
									disabled: otp.length < 4,
									className: "mt-6 w-full rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm disabled:opacity-50 active:scale-[0.99] transition",
									children: "Create account"
								})
							]
						})
					]
				}), /* @__PURE__ */ jsx("button", {
					type: "button",
					onClick: () => setStep(1),
					className: "mt-8 w-full text-center text-sm font-bold text-primary hover:underline",
					children: "Go back"
				})]
			}),
			step === 4 && /* @__PURE__ */ jsx("div", {
				className: "px-5 pt-4 pb-6 flex-1 flex flex-col justify-start relative z-10 overflow-y-auto",
				children: /* @__PURE__ */ jsxs("div", {
					className: "bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8 space-y-5",
					children: [/* @__PURE__ */ jsxs("div", { children: [
						/* @__PURE__ */ jsx("h2", {
							className: "text-xl font-extrabold tracking-tight text-foreground",
							children: "Personal information"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-xs text-muted-foreground mt-1",
							children: "Only your first name and vehicle details are visible to clients during the booking."
						}),
						/* @__PURE__ */ jsx("p", {
							className: "text-xs font-semibold text-primary mt-3 cursor-pointer hover:underline",
							children: "Need help getting documents? Click here!"
						})
					] }), /* @__PURE__ */ jsxs("form", {
						onSubmit: submitPersonalInfo,
						className: "space-y-4 text-left",
						children: [
							/* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [/* @__PURE__ */ jsx("span", {
									className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1",
									children: "First name *"
								}), /* @__PURE__ */ jsx("input", {
									type: "text",
									value: firstName,
									onChange: (e) => setFirstName(e.target.value),
									placeholder: "First name",
									required: true,
									className: "mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
								})]
							}),
							/* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [/* @__PURE__ */ jsx("span", {
									className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1",
									children: "Last name *"
								}), /* @__PURE__ */ jsx("input", {
									type: "text",
									value: lastName,
									onChange: (e) => setLastName(e.target.value),
									placeholder: "Last name",
									required: true,
									className: "mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
								})]
							}),
							/* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [/* @__PURE__ */ jsx("span", {
									className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1",
									children: "Date of Birth *"
								}), /* @__PURE__ */ jsx("div", {
									className: "relative mt-1",
									children: /* @__PURE__ */ jsx("input", {
										type: "date",
										value: dob,
										onChange: (e) => setDob(e.target.value),
										required: true,
										className: "w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none text-muted-foreground"
									})
								})]
							}),
							/* @__PURE__ */ jsxs("label", {
								className: "block",
								children: [
									/* @__PURE__ */ jsx("span", {
										className: "text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1",
										children: "ID Number or Passport Number *"
									}),
									/* @__PURE__ */ jsx("input", {
										type: "text",
										value: idNumber,
										onChange: (e) => setIdNumber(e.target.value),
										placeholder: "Enter your ID or passport number",
										required: true,
										className: "mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
									}),
									/* @__PURE__ */ jsx("p", {
										className: "text-[10px] text-muted-foreground mt-1 ml-1 leading-normal",
										children: "Your ID number is used for identity verification purposes."
									})
								]
							}),
							/* @__PURE__ */ jsx("button", {
								type: "submit",
								className: "mt-6 w-full rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition",
								children: "Create account"
							})
						]
					})]
				})
			})
		]
	});
}
//#endregion
export { Signup as component };
