/**
 * Convert button.
 */
import React from "react";
import Button from "react-bootstrap/lib/Button";

export default class Convert extends React.Component {
  onClick() {
    const store = this.props.ConvertStore;
    this.props.ConvertActions.fetchConversions(store.types, store.value);
  }

  render() {
    return (
      <span className="input-group-btn">
        <Button className="e2e-convert" onClick={this.onClick.bind(this)}>
          Convert
        </Button>
      </span>
    );
  }
}

Convert.propTypes = {
  ConvertActions: React.PropTypes.object,
  ConvertStore: React.PropTypes.object
};
