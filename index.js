const chunk = require('lodash.chunk');
const request = require('request-promise');
const excel = require('excel4node');
const flatten = require('lodash.flatten');
const retry = require('async-retry')
const _cliProgress = require('cli-progress');

const alphabet = 'abcdef'.split(''); //ghijklmnopqrstuvwxyz

class Generator {
  static async generateStrings(base) {
    const chars = [];

    for (let i = 0; i < base.length; i++) {
      chars.push(alphabet.indexOf(base[i]));
    }

    for (let i = chars.length - 1; i >= 0; i--) {
      const tmp = chars[i];
      if (tmp >= 0 && tmp < alphabet.length - 1) {
        chars[i]++;
        break;
      }
      else { chars[i] = 0; }
    }

    let newstr = "";
    for (let i = 0; i < chars.length; i++) {
      newstr += alphabet[chars[i]];
    }

    return newstr;
  }

  static async generateStringsWithLooper(base) {
    let temp = base;
    let strings = [];

    while (true) {
      strings.push(
        temp = await Generator.generateStrings(temp)
      );

      let lastLetter = alphabet[alphabet.length - 1]
      if (temp == base || temp == `${lastLetter}${lastLetter}${lastLetter}`) break;
    }

    return strings
  }
}

class Requester {
  static createPromiseList(chunk) {
    return chunk.map(str => {
      return new Promise(resolve => {
        Requester.getAirport(str).then(json => {
          resolve(json)
        })
      }).catch(err => console.error(err))
    })
  }

  static getAirport(term) {
    return request(`https://www.decolar.com/suggestions`, {
      method: 'GET',
      qs: {
        locale: 'pt-BR',
        profile: 'sbox-cp-vh',
        hint: term,
        fields: 'city'
      },
      json: true,
      transform: json => {
        return json
      }
    })
  }
}

class Xls {
  static writeSheet(airports) {
    let workbook = new excel.Workbook();
    let worksheet = workbook.addWorksheet('Airports');
    let headColumnStyle = workbook.createStyle({
      font: {
        bold: true,
        size: 12
      }
    })

    airports.forEach((airport, idx) => {
      Xls.setHeading(worksheet, headColumnStyle);
      Xls.writeColumn(worksheet, idx + 2, airport[0]);
    });

    workbook.write('Airports.xlsx');
  }

  static setHeading(worksheet, style) {
    [
      'ID',
      'DISPLAY',
      'TARGET/ID',
      'TARGET/GID',
      'TARGET/IATA',
      'TARGET/TYPE',
      'TG/PARENTS/CONTINENT',
      'TG/PARENTS/COUNTRY',
      'TG/PARENTS/ADM_DIVISION',
      'TG/PARENTS/CITY',
      'LOCATION/LAT',
      'LOCATION/LNG',
      'CITY/ID',
      'CY/TG/ID',
      'CY/TG/GID',
      'CY/TG/CODE',
      'CY/TG/TYPE',
      'CY/TG/PARENTS/CONTINENT',
      'CY/TG/PARENTS/COUNTRY',
      'CY/TG/PARENTS/ADM_DIVISION',
      'CY/DISPLAY',
      'CY/LOCATION/LAT',
      'CY/LOCATION/LNG'
    ].forEach((columnName, idx) => {
      worksheet.cell(1, idx + 1).string(columnName).style(style);
    })
  }

  static writeColumn(worksheet, columnLine, data) {
    let { id, target, display, location, city } = data;
    let { parents } = target;
    let { latitude, longitude } = location;
    let hasCity = city != null;

    [
      id,
      display,
      target.id,
      target.gid,
      target.iata || '',
      target.type,
      parents.continent,
      parents.country,
      parents.administrative_division,
      parents.city || '',
      latitude.toString(),
      longitude.toString(),
      hasCity ? city.id : '',
      hasCity ? city.target.id : '',
      hasCity ? city.target.gid : '',
      hasCity ? city.target.code : '',
      hasCity ? city.target.type : '',
      hasCity ? city.target.parents.continent : '',
      hasCity ? city.target.parents.country : '',
      hasCity ? city.target.parents.administrative_division : '',
      hasCity ? city.display : '',
      hasCity ? city.location.latitude.toString() : '',
      hasCity ? city.location.longitude.toString() : ''
    ].forEach((value, idx) => {
      worksheet.cell(columnLine, idx + 1).string(value)
    })
  }
}

class Runner {
  constructor() {
    this.bar = new _cliProgress.SingleBar({}, _cliProgress.Presets.shades_classic);
  }

  async getChunks() {
    let strings = await Generator.generateStringsWithLooper('aaa')
    return chunk(strings, 5)
  }

  async getAllAirports() {
    let chunks = await this.getChunks()
    let airports = []

    this.bar.start(chunks.length, 0);

    for (const [_idx, chunk] of chunks.entries()) {
      console.log(` ${chunk}`)

      await retry(async () => {
        let promises = Requester.createPromiseList(chunk)
        let response = await Promise.all(promises)

        airports = [...airports, ...response];
        this.bar.increment();
      }, { retries: 5 })
    }

    this.bar.stop()
    return this.filterAirports(airports)
  }

  filterAirports(airports) {
    return flatten(airports).map(airport => {
      let { items } = airport

      if (items != null) {
        let first = items[0]

        if (first != null) {
          return first.items
        }
      }
    }).filter(item => item != null)
  }
}

(async () => {
  let airports = await new Runner().getAllAirports()
  Xls.writeSheet(airports)
})()
