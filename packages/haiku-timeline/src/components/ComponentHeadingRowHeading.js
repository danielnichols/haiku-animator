import React from 'react'
import truncate from './helpers/truncate'
import Palette from './DefaultPalette'

export default class ComponentHeadingRowHeading extends React.Component {
  render () {
    const color = this.props.row.isExpanded() ? Palette.ROCK : Palette.ROCK_MUTED
    const elementName = this.props.row.element.getNameString()

    return (
      (this.props.row.isRootRow())
        ? (<div style={{height: 27, display: 'inline-block', transform: 'translateY(1px)'}}>
          {truncate(this.props.row.element.getTitle() || elementName, 12)}
        </div>)
        : (<span className='no-select'>
          <span
            style={{
              display: 'inline-block',
              fontSize: 21,
              position: 'relative',
              zIndex: 1005,
              verticalAlign: 'middle',
              color: Palette.GRAY_FIT1,
              marginRight: 7,
              marginTop: 1
            }}>
            <span style={{
              marginLeft: 5,
              backgroundColor: Palette.GRAY_FIT1,
              position: 'absolute',
              width: 1,
              height: 25
            }} />
            <span style={{marginLeft: 4}}>—</span>
          </span>
          <span
            style={{
              color,
              position: 'relative',
              zIndex: 1005
            }}>
            {truncate(this.props.row.element.getTitle() || `<${elementName}>`, 8)}
          </span>
        </span>)
    )
  }
}

ComponentHeadingRowHeading.propTypes = {
  row: React.PropTypes.object.isRequired,
  $update: React.PropTypes.object.isRequired,
}
